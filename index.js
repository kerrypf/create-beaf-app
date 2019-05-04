#!/usr/bin/env node

var chalk = require('chalk');

var currentNodeVersion = process.versions.node;
var semver = currentNodeVersion.split('.');
var major = semver[0];

if (major < 8) {
  console.error(
    chalk.red(
      'You are running Node ' +
      currentNodeVersion +
      '.\n' +
      'create-beaf-app requires Node 8 or higher. \n' +
      'Please update your version of Node.'
    )
  );
  process.exit(1);
}

require('./create-beaf-app');