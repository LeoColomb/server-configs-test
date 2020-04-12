// Copyright H5BP
//
// Licensed under the MIT License

const path = require('path')
const core = require('@actions/core')
const tc = require('@actions/tool-cache')
const exec = require('@actions/exec')
const artifact = require('@actions/artifact')

async function action () {
  // ------
  core.startGroup('Starting server container')
  const serverArgs = [
    '-v', `${path.join(__dirname, 'fixtures')}:${core.getInput('root-path', { required: true })}`
  ]
  if (core.getInput('certs-path')) {
    serverArgs.push('-v', `${path.join(__dirname, '../certs')}:${core.getInput('certs-path')}`)
  } else {
    core.warning('certs-path was not set')
  }
  const volumes = core.getInput('configs-volumes')
    .split(';')
    .filter(val => val !== '')
    .map(vlm => ['-v', `${process.cwd()}/${vlm}`])
  if (volumes.length) {
    serverArgs.push(...volumes.flat())
  }
  serverArgs.push(core.getInput('server', { required: true }))

  try {
    await exec.exec('docker', [
      'run',
      '--detach',
      '--network', 'host',
      '--name', 'server',
      ...serverArgs
    ])
  } catch (e) {
    core.setFailed(e.message)
    process.exit()
  }
  core.endGroup()

  // ------
  core.startGroup('Preparing server-configs-test')
  const k6Version = core.getInput('k6-version', { required: true })
  // ---
  core.debug(`Download k6 v${k6Version}`)
  let k6Path = tc.find('k6', k6Version)
  if (!k6Path) {
    const k6Download = await tc.downloadTool(`https://github.com/loadimpact/k6/releases/download/v${k6Version}/k6-v${k6Version}-linux64.tar.gz`)
    const k6ExtractedFolder = await tc.extractTar(k6Download)
    const k6Root = path.join(k6ExtractedFolder, `k6-v${k6Version}-linux64`)
    k6Path = await tc.cacheDir(k6Root, 'k6', k6Version)
  }
  core.addPath(k6Path)
  // ---
  core.debug('Build k6 arguments')
  const k6Args = ['run']
  const command = core.getInput('command', { required: true })
  if (command === 'test') {
    k6Args.push(
      path.join(__dirname, '../lib/index.js'),
      '-e', `TESTS=${core.getInput('tests')}`
    )
  } else if (command === 'benchmark') {
    k6Args.push(path.join(__dirname, '../lib/benchmark.js'))
  } else {
    core.setFailed('Invalid command')
  }
  if (core.isDebug()) {
    k6Args.push('--http-debug')
  }
  k6Args.push('--out', `json=${path.join(__dirname, '../sct-results.json')}`)
  core.endGroup()

  // ------
  try {
    await exec.exec('k6', k6Args)
  } catch (e) {
    core.setFailed(e.message)
  }

  // ------
  core.startGroup('Shutting down server and dumping logs')
  await exec.exec('docker', ['logs', 'server'])
  await exec.exec('docker', ['kill', 'server'])
  await exec.exec('docker', ['rm', 'server'])
  core.endGroup()

  // ------
  await artifact.create().uploadArtifact(
    `sct-${command}-results`,
    [path.join(__dirname, '../sct-results.json')],
    path.join(__dirname, '..'),
    { continueOnError: true }
  )
}

action()