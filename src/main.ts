/* eslint-disable @typescript-eslint/no-non-null-assertion */
import * as core from '@actions/core';
import { GitHub } from '@actions/github';
import { createHash, Hash } from 'crypto';
import request from 'request';

export async function getAssetDownloadUrl(
  token: string,
  repoSlug: string,
  tag: string,
  nameOrRegex: string
): Promise<string> {
  core.debug(`Creating Octokit API object...`);
  const api = new GitHub(token);

  const slugParts = repoSlug.split('/');
  if (slugParts.length !== 2) {
    throw new Error(
      `Invalid repo slug '${repoSlug}'. Should be in 'owner/repo' format.`
    );
  }

  const { data } = await api.repos.getReleaseByTag({
    owner: slugParts[0],
    repo: slugParts[1],
    tag: tag.replace(/(refs\/tags\/)/, '')
  });

  core.debug(`Found release ${data.url}.`);

  let asset;
  if (nameOrRegex.startsWith('/') && nameOrRegex.endsWith('/')) {
    const regex = new RegExp(nameOrRegex.substr(1, nameOrRegex.length - 2));
    core.debug(`Matching asset name as regular expression: ${regex}`);
    asset = data.assets.find(x => regex.test(x.name));
  } else {
    core.debug(`Matching asset name literally: ${nameOrRegex}`);
    const lowerName = nameOrRegex.toLowerCase();
    asset = data.assets.find(x => x.name.toLowerCase() === lowerName);
  }

  if (!asset) {
    throw new Error(`No asset was found matching ${nameOrRegex}.`);
  }

  core.debug(`Found asset ${asset.url}.`);
  return asset.browser_download_url;
}

export async function computeHashAsync(
  url: string,
  hash: Hash
): Promise<string> {
  const lowerUrl = url.toLowerCase();
  if (!lowerUrl.startsWith('https://') && !lowerUrl.startsWith('http://')) {
    throw new Error(`Unknown scheme type in URL '${url}'.`);
  }

  return new Promise<string>((resolve, reject) => {
    request(url)
      .on('error', err => {
        reject(
          new Error(`Failed to download ${url}: [${err.name}] ${err.message}.`)
        );
      })
      .on('complete', () => {
        hash.end();
        resolve(hash.digest('hex'));
      })
      .pipe(hash);
  });
}

async function run(): Promise<void> {
  try {
    const repo: string =
      core.getInput('repo') || process.env.GITHUB_REPOSITORY!;
    const tag: string = core.getInput('tag') || process.env.GITHUB_REF!;
    const asset: string = core.getInput('asset');
    const hashType: string = core.getInput('hash');
    const token: string = core.getInput('token') || process.env.GITHUB_TOKEN!;

    core.debug(`repo=${repo}`);
    core.debug(`tag=${tag}`);
    core.debug(`asset=${asset}`);
    core.debug(`hashType=${hashType}`);

    core.debug(`Creating hash object for ${hashType}...`);
    const hash = createHash(hashType);

    core.debug(`Getting release asset from ${repo} @ ${tag}...`);
    const url: string = await getAssetDownloadUrl(token, repo, tag, asset);
    core.debug(`Release asset download URL is ${url}.`);

    core.debug(`Computing hash of file ${url}...`);
    const result = await computeHashAsync(url, hash);
    core.debug(`Hash (${hashType}) is ${result}...`);

    core.setOutput('result', result);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error);
    } else {
      core.setFailed(`Unknown error occurred.`)
    }
  }
}

run();
