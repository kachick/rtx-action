import * as cache from '@actions/cache'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as glob from '@actions/glob'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {rtxDir} from './utils'

async function run(): Promise<void> {
  const rtxVersion =
    core.getInput('rtx_version', {required: false, trimWhitespace: true}) ||
    'latest'
  const githubToken = core.getInput('github_token', {
    required: false,
    trimWhitespace: true
  })
  core.setSecret(githubToken)
  await setToolVersions()
  await restoreRTXCache()
  await setupRTX(rtxVersion, githubToken)
  await exec.exec('rtx', ['--version'])
  await exec.exec('rtx', ['install'])
  await setPaths()
}

async function restoreRTXCache(): Promise<void> {
  const cachePath = rtxDir()
  const fileHash = await glob.hashFiles(`**/.tool-versions\n**/.rtx.toml`)
  const primaryKey = `rtx-tools-${getOS()}-${os.arch()}-${fileHash}`

  core.saveState('PRIMARY_KEY', primaryKey)

  const cacheKey = await cache.restoreCache([cachePath], primaryKey)
  core.setOutput('cache-hit', Boolean(cacheKey))

  if (!cacheKey) {
    core.info(`rtx cache not found for ${getOS()}-${os.arch()} tool versions`)
    return
  }

  core.saveState('CACHE_KEY', cacheKey)
  core.info(`rtx cache restored from key: ${cacheKey}`)
}

async function setupRTX(version: string, githubToken: string): Promise<void> {
  const rtxBinDir = path.join(rtxDir(), 'bin')
  await fs.promises.mkdir(rtxBinDir, {recursive: true})

  if (version === 'latest') {
    const url = `https://rtx.pub/rtx-latest-${getOS()}-${os.arch()}`
    await exec.exec('curl', [url, '--output', path.join(rtxBinDir, 'rtx')])
  } else {
    await exec.exec(
      'gh',
      [
        'release',
        'download',
        version,
        '--pattern',
        `*${getOS()}-${os.arch()}`,
        '--repo',
        'jdxcode/rtx',
        '--output',
        path.join(rtxBinDir, 'rtx')
      ],
      {env: {GH_TOKEN: githubToken}}
    )
  }

  await exec.exec('chmod', ['+x', path.join(rtxBinDir, 'rtx')])
  core.addPath(rtxBinDir)
}

// returns true if tool_versions was set
async function setToolVersions(): Promise<Boolean> {
  const toolVersions = core.getInput('tool_versions', {required: false})
  if (toolVersions) {
    await fs.promises.writeFile('.tool-versions', toolVersions, {
      encoding: 'utf8'
    })
    return true
  }
  return false
}

function getOS(): string {
  switch (process.platform) {
    case 'darwin':
      return 'macos'
    default:
      return process.platform
  }
}

async function setPaths(): Promise<void> {
  for (const binPath of await getBinPaths()) {
    core.addPath(binPath)
  }
}

async function getBinPaths(): Promise<string[]> {
  const output = await exec.getExecOutput('rtx', ['bin-paths'])
  return output.stdout.split('\n')
}

if (require.main === module) {
  try {
    run()
  } catch (err) {
    if (err instanceof Error) {
      core.setFailed(err.message)
    } else throw err
  }
}

export {run}
