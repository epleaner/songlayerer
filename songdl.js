import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

function sanitizeFilename(filename) {
  return filename.replace(/[/\\?%*:|"<>]/g, '-');
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

  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Extract info without downloading
  try {
    execSync(`yt-dlp --dump-json "${searchQuery}" > ${jsonFilename}`);
  } catch (error) {
    console.error('Error during search:', error.message);
    return;
  }

  // Read and parse the JSON file
  const jsonContent = fs.readFileSync(jsonFilename, 'utf8');
  const entries = jsonContent.trim().split('\n').map(JSON.parse);

  // Sort entries by view count
  const sortedEntries = entries.sort(
    (a, b) => (b.view_count || 0) - (a.view_count || 0)
  );

  // Filter entries based on excludeKeywords
  const filteredEntries = sortedEntries.filter((entry) => {
    const lowerTitle = entry.title.toLowerCase();
    return !excludeKeywords.some((keyword) =>
      lowerTitle.includes(keyword.toLowerCase())
    );
  });

  // Download top N covers from filtered results
  filteredEntries.slice(0, numCovers).forEach((entry, index) => {
    const title = sanitizeFilename(entry.title);
    console.log(`Downloading ${index + 1}/${numCovers}: ${title}`);

    try {
      execSync(
        `yt-dlp -x --audio-format mp3 --audio-quality 0 -o "${path.join(
          outputDir,
          title
        )}.%(ext)s" ${entry.webpage_url}`,
        { stdio: 'inherit' }
      );
    } catch (error) {
      console.error(`Error downloading ${title}:`, error.message);
    }
  });

  // Clean up
  fs.unlinkSync(jsonFilename);
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
