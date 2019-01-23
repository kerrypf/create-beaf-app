const path = require('path');
const os = require('os');
const url = require('url');
const execSync = require('child_process').execSync;
const dns = require('dns'); //具有Web UI的DNS服务器,使用ReDIS的配置存储

const validateProjectName = require('validate-npm-package-name');
const chalk = require('chalk');
const commander = require('commander');
const fs = require('fs-extra');  //fs-extra adds file system methods that aren't included in the native fs module and adds promise support to the fs methods
const spawn = require('cross-spawn');
const hyperquest = require('hyperquest'); //treat http requests as a streaming transport
const tmp = require('tmp');  //一个简单的临时文件和目录生成器
const unpack = require('tar-pack').unpack;

const semver = require('semver'); //语义版本





// const envinfo = require('envinfo');


const packageJson = require('./package.json');


// These files should be allowed to remain on a failed install,
// but then silently removed during the next create.
const errorLogFilePatterns = [
    'npm-debug.log',
    'yarn-error.log',
    'yarn-debug.log',
];

let projectName;

/**
 * 定义命令hang
 */

const program = new commander.Command(packageJson.name)  //初始化命令行对象参数
  .version(packageJson.version)
  .arguments('<project-name>')  //Angled brackets (e.g. <project-name>) indicate required input
  .usage(`${chalk.green('<project-name>')} [options]`)
  .action(name => {
    projectName = name;
  })
  .option('--verbose', 'print additional logs')
  .option('--info', 'print environment debug info')
  .option(
    '--scripts-version <alternative-package>',
    'use a non-standard version of create-beaf-app'
  )
  .option('--use-npm')
  .allowUnknownOption()
  .on('--help', () => {
    console.log(`    Only ${chalk.green('<project-name>')} is required.`);
    console.log();
    console.log(
      `    A custom ${chalk.cyan('--scripts-version')} can be one of:`
    );
    console.log(`      - a specific npm version: ${chalk.green('0.8.2')}`);
    console.log(`      - a specific npm tag: ${chalk.green('@next')}`);
    console.log(
      `      - a custom fork published on npm: ${chalk.green(
        'my-react-scripts'
      )}`
    );
    console.log(
      `      - a local path relative to the current working directory: ${chalk.green(
        'file:../my-react-scripts'
      )}`
    );
    console.log(
      `      - a .tgz archive: ${chalk.green(
        'https://mysite.com/my-react-scripts-0.8.2.tgz'
      )}`
    );
    console.log(
      `      - a .tar.gz archive: ${chalk.green(
        'https://mysite.com/my-react-scripts-0.8.2.tar.gz'
      )}`
    );
    console.log(
      `    It is not needed unless you specifically want to use a fork.`
    );
    console.log();
    console.log(
      `    If you have any problems, do not hesitate to file an issue:`
    );
    console.log(
      `      ${chalk.cyan(
        'https://github.com/facebook/create-react-app/issues/new'
      )}`
    );
    console.log();
  })
  .parse(process.argv);  //所有的选项被注册后，就调用parse()来处理命令行。一般传入的是process.argv，解析后，参数的值就可以通过它们的全称来获取。


console.log(program.info)

if (typeof projectName === 'undefined') {
    console.error(`${chalk.yellow('warning: no command given!')}`);
    console.error('Please specify the project name:');
    console.log(
        `  ${chalk.cyan(program.name())} ${chalk.green('<project-name>')}`
    );
    console.log();
    console.log('For example:');
    console.log(`  ${chalk.cyan(program.name())} ${chalk.green('my-vue-app')}`);
    console.log();
    console.log(
        `Run ${chalk.cyan(`${program.name()} --help`)} to see all options.`
    );
    process.exit(1);
}


// const hiddenProgram = new commander.Command()
//     .option(
//         '--internal-testing-template <path-to-template>',
//         '(internal usage only, DO NOT RELY ON THIS) ' +
//         'use a non-standard application template'
//     )
//     .parse(process.argv);


createApp(
    projectName,
    program.verbose,
    program.scriptsVersion,
    program.useNpm,
    // hiddenProgram.internalTestingTemplate
);

function createApp(name, verbose, version, useNpm, template) {
    const root = path.resolve(name);  //处理成绝对路径
    const appName = path.basename(root);
    
    checkAppName(appName); //验证项目名称是否是npm有效的包名，是否与依赖重名
    fs.ensureDirSync(name); //创建目录
    if (!isSafeToCreateProjectIn(root, name)) { //不允许手动创建，二次创建时先清除上次创建的日志文件
        process.exit(1);
    }
    
    console.log(`Creating a new beaf app in ${chalk.green(root)}.`);
    console.log();
    
    const packageJson = {
        name: appName,
        version: '0.1.0',
        private: true,
        license: "MIT",
        "husky": {
          "hooks": {
            "pre-commit": "lint-staged"
          }
        },
        "lint-staged": {
          "**/*.{js,json,md}": [
            "prettier --write",
            "git add"
          ]
        }
    };
    fs.writeFileSync( //同步的将数据写入文件，如果文件已存在，则覆盖文件
        path.join(root, 'package.json'),  //目标文件
        JSON.stringify(packageJson, null, 2) + os.EOL  //数据
    );
    

    //cwd() 是当前执行node命令时候的文件夹地址 
    //__dirname 是被执行的js 文件的地址
    const useYarn = useNpm ? false : shouldUseYarn(root);
    const originalDirectory = process.cwd();
    process.chdir(root); //变更Node.js进程的当前工作目录
    if (!useYarn && !checkThatNpmCanReadCwd()) {
        process.exit(1);
    }
    
    //安装依赖
    run(root, appName, version, verbose, originalDirectory, template, useYarn);
}

function checkAppName(appName) {
    const validationResult = validateProjectName(appName);
    if (!validationResult.validForNewPackages) {
      console.error(
        `Could not create a project called ${chalk.red(
          `"${appName}"`
        )} because of npm naming restrictions:`
      );
      printValidationResults(validationResult.errors);
      printValidationResults(validationResult.warnings);
      process.exit(1);
    }
  
    // TODO: there should be a single place that holds the dependencies
    const dependencies = ['vue', 'vuex', 'vue-router'].sort();
    if (dependencies.indexOf(appName) >= 0) {
      console.error(
        chalk.red(
          `We cannot create a project called ${chalk.green(
            appName
          )} because a dependency with the same name exists.\n` +
          `Due to the way npm works, the following names are not allowed:\n\n`
        ) +
        chalk.cyan(dependencies.map(depName => `  ${depName}`).join('\n')) +
        chalk.red('\n\nPlease choose a different project name.')
      );
      process.exit(1);
    }
}

function printValidationResults(results) {
    if (typeof results !== 'undefined') {
        results.forEach(error => {
            console.error(chalk.red(`  *  ${error}`));
        });
    }
}
// If project only contains files generated by GH, it’s safe.
// Also, if project contains remnant error logs from a previous
// installation, lets remove them now.
// We also special case IJ-based products .idea because it integrates with CRA:
// https://github.com/facebook/create-react-app/pull/368#issuecomment-243446094
function isSafeToCreateProjectIn(root, name) {
    const validFiles = [
      '.DS_Store',
      'Thumbs.db',
      '.git',
      '.gitignore',
      '.idea',
      'README.md',
      'LICENSE',
      'web.iml',
      '.hg',
      '.hgignore',
      '.hgcheck',
      '.npmignore',
      'mkdocs.yml',
      'docs',
      '.travis.yml',
      '.gitlab-ci.yml',
      '.gitattributes',
    ];
    console.log();
  
    const conflicts = fs
      .readdirSync(root)  //根目录下所有目录列表
      .filter(file => !validFiles.includes(file))
      // Don't treat log files from previous installation as conflicts
      .filter(
        file => !errorLogFilePatterns.some(pattern => file.indexOf(pattern) === 0)
      );
  
    if (conflicts.length > 0) {
      console.log(
        `The directory ${chalk.green(name)} contains files that could conflict:`
      );
      console.log();
      for (const file of conflicts) {
        console.log(`  ${file}`);
      }
      console.log();
      console.log(
        'Either try using a new directory name, or remove the files listed above.'
      );
  
      return false;
    }
  
    // Remove any remnant files from a previous installation
    const currentFiles = fs.readdirSync(path.join(root));
    currentFiles.forEach(file => {
      errorLogFilePatterns.forEach(errorLogFilePattern => {
        // This will catch `(npm-debug|yarn-error|yarn-debug).log*` files
        if (file.indexOf(errorLogFilePattern) === 0) {
          fs.removeSync(path.join(root, file));
        }
      });
    });
    return true;
}

function isYarnAvailable() {
    try {
      execSync('yarnpkg --version', { stdio: 'ignore' });
      return true;
    } catch (e) {
      return false;
    }
}
  
function shouldUseYarn(appDir) {
    return isYarnAvailable()
}
function checkThatNpmCanReadCwd() {
    const cwd = process.cwd();
    let childOutput = null;
    try {
      // Note: intentionally using spawn over exec since
      // the problem doesn't reproduce otherwise.
      // `npm config list` is the only reliable way I could find
      // to reproduce the wrong path. Just printing process.cwd()
      // in a Node process was not enough.
      childOutput = spawn.sync('npm', ['config', 'list']).output.join('');
    } catch (err) {
      // Something went wrong spawning node.
      // Not great, but it means we can't do this check.
      // We might fail later on, but let's continue.
      return true;
    }
    if (typeof childOutput !== 'string') {
      return true;
    }
    const lines = childOutput.split('\n');
    // `npm config list` output includes the following line:
    // "; cwd = C:\path\to\current\dir" (unquoted)
    // I couldn't find an easier way to get it.
    const prefix = '; cwd = ';
    const line = lines.find(line => line.indexOf(prefix) === 0);
    if (typeof line !== 'string') {
      // Fail gracefully. They could remove it.
      return true;
    }
    const npmCWD = line.substring(prefix.length);
    if (npmCWD === cwd) {
      return true;
    }
    console.error(
      chalk.red(
        `Could not start an npm process in the right directory.\n\n` +
        `The current directory is: ${chalk.bold(cwd)}\n` +
        `However, a newly started npm process runs in: ${chalk.bold(
          npmCWD
        )}\n\n` +
        `This is probably caused by a misconfigured system terminal shell.`
      )
    );
    if (process.platform === 'win32') {
      console.error(
        chalk.red(`On Windows, this can usually be fixed by running:\n\n`) +
        `  ${chalk.cyan(
          'reg'
        )} delete "HKCU\\Software\\Microsoft\\Command Processor" /v AutoRun /f\n` +
        `  ${chalk.cyan(
          'reg'
        )} delete "HKLM\\Software\\Microsoft\\Command Processor" /v AutoRun /f\n\n` +
        chalk.red(`Try to run the above two lines in the terminal.\n`) +
        chalk.red(
          `To learn more about this problem, read: https://blogs.msdn.microsoft.com/oldnewthing/20071121-00/?p=24433/`
        )
      );
    }
    return false;
}
function checkNodeVersion(packageName) {
    const packageJsonPath = path.resolve(  //脚手架包的package.json文件
      process.cwd(),
      'node_modules',
      packageName,
      'package.json'
    );
    const packageJson = require(packageJsonPath);
    if (!packageJson.engines || !packageJson.engines.node) {
      return;
    }
  
    if (!semver.satisfies(process.version, packageJson.engines.node)) {
      console.error(
        chalk.red(
          'You are running Node %s.\n' +
          'Create React App requires Node %s or higher. \n' +
          'Please update your version of Node.'
        ),
        process.version,
        packageJson.engines.node
      );
      process.exit(1);
    }
  }

function run(
    root,
    appName,
    version,
    verbose,
    originalDirectory,
    template,
    useYarn
  ) {
    const packageToInstall = getInstallPackage(version, originalDirectory);
    const allDependencies = [
      'vue',
      'vuex',
      'vue-router',
      'element-ui',
      'lodash',
      "axios",
      "json-server",
      packageToInstall
    ];
  
    const prettierLintStageDependencies = [
      "husky",
      "lint-staged",
      "prettier"
    ];
  
    console.log('Installing packages. This might take a couple of minutes.');
    getPackageName(packageToInstall)
      .then(packageName =>
        checkIfOnline(useYarn).then(isOnline => ({  //检验网络是否连接,可离线安装
          isOnline: isOnline,
          packageName: packageName,
        }))
      )
      .then(info => {
        const isOnline = info.isOnline;
        const packageName = info.packageName;
        console.log(`Installing packages ...`);
        allDependencies.forEach( dep => {
          console.log(`*  ${ chalk.cyan(dep) }`);
        } );
        console.log("Prettier dependencies");
  
        prettierLintStageDependencies.forEach( dep =>
          console.log(`*  ${ chalk.cyan(dep) }`)
        );
  
        console.log();
  
        return install(root, useYarn, allDependencies.concat(prettierLintStageDependencies), verbose, isOnline).then(
          () => packageName
        );
      })
      .then(packageName => {
        checkNodeVersion(packageName);
        setCaretRangeForRuntimeDeps(packageName);
  
        const scriptsPath = path.resolve(
          process.cwd(),
          'node_modules',
          packageName,
          'scripts',
          'init.js'
        );
        const init = require(scriptsPath);
        init(root, appName, verbose, originalDirectory, template);
  
      })
      .catch(reason => {
        console.log();
        console.log('Aborting installation.');
        if (reason.command) {
          console.log(`  ${chalk.cyan(reason.command)} has failed.`);
        } else {
          console.log(chalk.red('Unexpected error. Please report it as a bug:'));
          console.log(reason);
        }
        console.log();
  
        // On 'exit' we will delete these files from target directory.
        const knownGeneratedFiles = ['package.json', 'node_modules'];
        const currentFiles = fs.readdirSync(path.join(root));
        currentFiles.forEach(file => {
          knownGeneratedFiles.forEach(fileToMatch => {
            // This remove all of knownGeneratedFiles.
            if (file === fileToMatch) {
              console.log(`Deleting generated file... ${chalk.cyan(file)}`);
              fs.removeSync(path.join(root, file));
            }
          });
        });
        const remainingFiles = fs.readdirSync(path.join(root));
        if (!remainingFiles.length) {
          // Delete target folder if empty
          console.log(
            `Deleting ${chalk.cyan(`${appName}/`)} from ${chalk.cyan(
              path.resolve(root, '..')
            )}`
          );
          process.chdir(path.resolve(root, '..'));
          fs.removeSync(path.join(root));
        }
        console.log('Done.');
        process.exit(1);
      });
}

function install(root, useYarn, dependencies, verbose, isOnline) {
    return new Promise((resolve, reject) => {
      let command;
      let args;
      if (useYarn) {
        command = 'yarnpkg';
        args = ['add', '--exact'];
        if (!isOnline) {
          args.push('--offline');
        }
        [].push.apply(args, dependencies);
  
        // Explicitly set cwd() to work around issues like
        // https://github.com/facebook/create-react-app/issues/3326.
        // Unfortunately we can only do this for Yarn because npm support for
        // equivalent --prefix flag doesn't help with this issue.
        // This is why for npm, we run checkThatNpmCanReadCwd() early instead.
        args.push('--cwd');
        args.push(root);
  
        if (!isOnline) {
          console.log(chalk.yellow('You appear to be offline.'));
          console.log(chalk.yellow('Falling back to the local Yarn cache.'));
          console.log();
        }
      } else {
        command = 'npm';
        args = [
          'install',
          '--save',
          '--save-exact',
          '--loglevel',
          'error',
        ].concat(dependencies);
      }
  
      if (verbose) {
        args.push('--verbose');
      }
  
      const child = spawn(command, args, { stdio: 'inherit' });
      child.on('close', code => {
        if (code !== 0) {
          reject({
            command: `${command} ${args.join(' ')}`,
          });
          return;
        }
        resolve();
      });
    });
}

function getInstallPackage(version, originalDirectory) {
    //当前使用最新版本的, TODO 设定版本的方式
    return "beaf-scripts"
  //  let packageToInstall = 'react-scripts';
  //  const validSemver = semver.valid(version);
  //  if (validSemver) {
  //    packageToInstall += `@${validSemver}`;
  //  } else if (version) {
  //    if (version[0] === '@' && version.indexOf('/') === -1) {
  //      packageToInstall += version;
  //    } else if (version.match(/^file:/)) {
  //      packageToInstall = `file:${path.resolve(
  //        originalDirectory,
  //        version.match(/^file:(.*)?$/)[1]
  //      )}`;
  //    } else {
  //      // for tar.gz or alternative paths
  //      packageToInstall = version;
  //    }
  //  }
  //  return packageToInstall;
}
// Extract package name from tarball url or path.
function getPackageName(installPackage) {
    if (installPackage.match(/^.+\.(tgz|tar\.gz)$/)) {
      return getTemporaryDirectory()
        .then(obj => {
          let stream;
          if (/^http/.test(installPackage)) {
            stream = hyperquest(installPackage);
          } else {
            stream = fs.createReadStream(installPackage);
          }
          return extractStream(stream, obj.tmpdir).then(() => obj);
        })
        .then(obj => {
          const packageName = require(path.join(obj.tmpdir, 'package.json')).name;
          obj.cleanup();
          return packageName;
        })
        .catch(err => {
          // The package name could be with or without semver version, e.g. react-scripts-0.2.0-alpha.1.tgz
          // However, this function returns package name only without semver version.
          console.log(
            `Could not extract the package name from the archive: ${err.message}`
          );
          const assumedProjectName = installPackage.match(
            /^.+\/(.+?)(?:-\d+.+)?\.(tgz|tar\.gz)$/
          )[1];
          console.log(
            `Based on the filename, assuming it is "${chalk.cyan(
              assumedProjectName
            )}"`
          );
          return Promise.resolve(assumedProjectName);
        });
    } else if (installPackage.indexOf('git+') === 0) {
      // Pull package name out of git urls e.g:
      // git+https://github.com/mycompany/react-scripts.git
      // git+ssh://github.com/mycompany/react-scripts.git#v1.2.3
      return Promise.resolve(installPackage.match(/([^/]+)\.git(#.*)?$/)[1]);
    } else if (installPackage.match(/.+@/)) {
      // Do not match @scope/ when stripping off @version or @tag
      return Promise.resolve(
        installPackage.charAt(0) + installPackage.substr(1).split('@')[0]
      );
    } else if (installPackage.match(/^file:/)) {
      const installPackagePath = installPackage.match(/^file:(.*)?$/)[1];
      const installPackageJson = require(path.join(
        installPackagePath,
        'package.json'
      ));
      return Promise.resolve(installPackageJson.name);
    }
    return Promise.resolve(installPackage);
}
function setCaretRangeForRuntimeDeps(packageName) {
    const packagePath = path.join(process.cwd(), 'package.json');
    const packageJson = require(packagePath);
  
    if (typeof packageJson.dependencies === 'undefined') {
      console.error(chalk.red('Missing dependencies in package.json'));
      process.exit(1);
    }
  
    const packageVersion = packageJson.dependencies[packageName];
    if (typeof packageVersion === 'undefined') {
      console.error(chalk.red(`Unable to find ${packageName} in package.json`));
      process.exit(1);
    }
  
    makeCaretRange(packageJson.dependencies, 'vue');
    makeCaretRange(packageJson.dependencies, 'vuex');
  
    fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + os.EOL);
  }
  function makeCaretRange(dependencies, name) {
    const version = dependencies[name];
  
    if (typeof version === 'undefined') {
      console.error(chalk.red(`Missing ${name} dependency in package.json`));
      process.exit(1);
    }
  
    let patchedVersion = `^${version}`;
  
    if (!semver.validRange(patchedVersion)) {
      console.error(
        `Unable to patch ${name} dependency version because version ${chalk.red(
          version
        )} will become invalid ${chalk.red(patchedVersion)}`
      );
      patchedVersion = version;
    }
  
    dependencies[name] = patchedVersion;
  }




//
function getTemporaryDirectory() {
    return new Promise((resolve, reject) => {
      // Unsafe cleanup lets us recursively delete the directory if it contains
      // contents; by default it only allows removal if it's empty
      tmp.dir({ unsafeCleanup: true }, (err, tmpdir, callback) => {
        if (err) {
          reject(err);
        } else {
          resolve({
            tmpdir: tmpdir,
            cleanup: () => {
              try {
                callback();
              } catch (ignored) {
                // Callback might throw and fail, since it's a temp directory the
                // OS will clean it up eventually...
              }
            },
          });
        }
      });
    });
  }
function extractStream(stream, dest) {
    return new Promise((resolve, reject) => {
        stream.pipe(
        unpack(dest, err => {
            if (err) {
            reject(err);
            } else {
            resolve(dest);
            }
        })
        );
    });
}
function checkIfOnline(useYarn) {
    if (!useYarn) {
      // Don't ping the Yarn registry.
      // We'll just assume the best case.
      return Promise.resolve(true);
    }
  
    return new Promise(resolve => {
      dns.lookup('registry.yarnpkg.com', err => {  //查找 registry.yarnpkg.com
        let proxy;
        if (err != null && (proxy = getProxy())) {
          // If a proxy is defined, we likely can't resolve external hostnames.
          // Try to resolve the proxy name as an indication of a connection.
          dns.lookup(url.parse(proxy).hostname, proxyErr => {
            resolve(proxyErr == null);
          });
        } else {
          resolve(err == null);
        }
      });
    });
}
function getProxy() {
    if (process.env.https_proxy) {
      return process.env.https_proxy;
    } else {
      try {
        // Trying to read https-proxy from .npmrc
        let httpsProxy = execSync('npm config get https-proxy')
          .toString()
          .trim();
        return httpsProxy !== 'null' ? httpsProxy : undefined;
      } catch (e) {
        return;
      }
    }
}