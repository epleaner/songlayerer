import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

function sanitizeFilename(filename) {
  return filename.replace(/[/\\?%*:|"<>]/g, '-');
}

function ytDlpVersion() {
  try {
    return String(execFileSync('yt-dlp', ['--version'], { encoding: 'utf8' }))
      .trim()
      .slice(0, 32);
  } catch {
    return null;
  }
}

function cookiesArgs() {
  const args = [];
  if (process.env.YTDLP_COOKIES_FROM_BROWSER) {
    args.push('--cookies-from-browser', process.env.YTDLP_COOKIES_FROM_BROWSER);
  }
  if (process.env.YTDLP_COOKIES) {
    args.push('--cookies', process.env.YTDLP_COOKIES);
  }
  return args;
}

function ytDlpCommonArgs() {
  const args = [
    '--sleep-interval',
    '1',
    '--max-sleep-interval',
    '5',
    '--retries',
    '3',
    '--fragment-retries',
    '3',
  ];

  // Default to web client. Android often requires PO tokens and/or can yield fragment 403s.
  const playerClients = process.env.YTDLP_PLAYER_CLIENTS || 'web';

  // Prefer stable clients; some client combos can trigger m3u8 403 issues.
  args.push('--extractor-args', `youtube:player_client=${playerClients}`);
  args.push(...cookiesArgs());

  return args;
}

function entryWebpageUrl(entry) {
  if (entry?.webpage_url) return String(entry.webpage_url);
  const url = entry?.url ? String(entry.url) : '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  const id = entry?.id ? String(entry.id) : url;
  if (id) return `https://www.youtube.com/watch?v=${id}`;
  return null;
}

function downloadTopCovers(songName, numCovers, baseDir, excludeKeywords = []) {
  const outputDir = path.join(baseDir, 'songs');
  const excludeQuery = excludeKeywords
    .map((keyword) => `-intitle:"${keyword}"`)
    .join(' ');
  const searchQuery = `ytsearch${
    numCovers * 2
  }:${songName} cover ${excludeQuery}`;
  const jsonFilename = path.join(baseDir, 'search_results.json');

  const v = ytDlpVersion();
  if (v && /^\d{4}\.\d{2}\.\d{2}$/.test(v) && v < '2025.01.01') {
    console.warn(
      `[yt-dlp] Detected version ${v}. If downloads fail with "Signature extraction failed", update yt-dlp (macOS: brew upgrade yt-dlp).`
    );
  }

  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Extract search results without format extraction (more robust vs YouTube breakages)
  try {
    const jsonOut = execFileSync(
      'yt-dlp',
      [...ytDlpCommonArgs(), '--flat-playlist', '--dump-json', searchQuery],
      {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 50,
      }
    );
    fs.writeFileSync(jsonFilename, jsonOut, 'utf8');
  } catch (error) {
    console.error('Error during search:', error.message);
    return 0;
  }

  // Read and parse the JSON file
  const jsonContent = fs.readFileSync(jsonFilename, 'utf8');
  const trimmed = jsonContent.trim();
  if (!trimmed) {
    console.error('Error during search: no results returned by yt-dlp.');
    fs.unlinkSync(jsonFilename);
    return 0;
  }
  const entries = trimmed.split('\n').map(JSON.parse);

  const hasViews = entries.some((e) => typeof e.view_count === 'number');
  const sortedEntries = hasViews
    ? entries.sort((a, b) => (b.view_count || 0) - (a.view_count || 0))
    : entries;

  // Filter entries based on excludeKeywords
  const filteredEntries = sortedEntries.filter((entry) => {
    const lowerTitle = entry.title.toLowerCase();
    return !excludeKeywords.some((keyword) =>
      lowerTitle.includes(keyword.toLowerCase())
    );
  });

  let downloadedCount = 0;

  // Download up to N successful covers from filtered results
  for (const entry of filteredEntries) {
    if (downloadedCount >= numCovers) break;
    const index = downloadedCount;
    const title = sanitizeFilename(entry.title);
    const url = entryWebpageUrl(entry);
    if (!url) continue;
    console.log(`Downloading ${index + 1}/${numCovers}: ${title}`);

    const baseArgs = [
      ...ytDlpCommonArgs(),
      // Prefer non-HLS audio when possible to avoid "retrying fragment ... 403" failures.
      // Fall back below if the video doesn't expose suitable formats.
      '-f',
      'bestaudio[protocol!*=m3u8][ext=m4a]/bestaudio[protocol!*=m3u8]/bestaudio/best',
      '--downloader',
      'ffmpeg',
      '--hls-prefer-ffmpeg',
      '-x',
      '--audio-format',
      'mp3',
      '--audio-quality',
      '0',
      '-o',
      `${path.join(outputDir, title)}.%(ext)s`,
      url,
    ];

    try {
      execFileSync('yt-dlp', baseArgs, { stdio: 'inherit' });
      const outFile = path.join(outputDir, `${title}.mp3`);
      if (fs.existsSync(outFile)) downloadedCount += 1;
    } catch (error) {
      // Retry without strict format preference (still keeping common args)
      try {
        execFileSync(
          'yt-dlp',
          [
            ...ytDlpCommonArgs(),
            '--downloader',
            'ffmpeg',
            '--hls-prefer-ffmpeg',
            '-x',
            '--audio-format',
            'mp3',
            '--audio-quality',
            '0',
            '-o',
            `${path.join(outputDir, title)}.%(ext)s`,
            url,
          ],
          { stdio: 'inherit' }
        );
        const outFile = path.join(outputDir, `${title}.mp3`);
        if (fs.existsSync(outFile)) downloadedCount += 1;
      } catch (error2) {
        console.error(`Error downloading ${title}:`, error2.message);
        console.error(
          'Tip: if you see "Signature extraction failed" or lots of 403s, update yt-dlp. On macOS: `brew upgrade yt-dlp`. Cookies can also help: set YTDLP_COOKIES_FROM_BROWSER=chrome.'
        );
      }
    }
  }

  // Clean up
  fs.unlinkSync(jsonFilename);

  return downloadedCount;
}

// Export the function for use in main.js
export { downloadTopCovers };

// Main execution (when run directly)
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args.length < 3 || args.length > 4) {
    console.log(
      "Usage: node songdl.js 'song name' number_of_covers base_directory [exclude_keywords]"
    );
    process.exit(1);
  }

  const songName = args[0];
  const numCovers = parseInt(args[1], 10);
  const baseDir = path.resolve(args[2]);
  const excludeKeywords = args[3] ? args[3].split(',') : [];

  if (isNaN(numCovers) || numCovers <= 0) {
    console.log('Number of covers must be a positive integer');
    process.exit(1);
  }

  downloadTopCovers(songName, numCovers, baseDir, excludeKeywords);
}
