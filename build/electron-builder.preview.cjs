const { build, version } = require('../package.json');

// Local unsigned packages share the application's release version.
module.exports = {
  ...build,
  directories: { ...build.directories, output: `release/${version}` },
  extraMetadata: { version },
  buildVersion: version,
  artifactName: 'OKNote-${version}-${os}-${arch}.${ext}',
  publish: null,
  mac: {
    ...build.mac,
    identity: null,
    notarize: false,
    hardenedRuntime: false,
    target: [{ target: 'zip', arch: ['arm64', 'x64'] }],
  },
};
