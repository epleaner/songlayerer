# Audio Cover Layering Tool

This project is a Node.js-based tool that downloads cover versions of a song, time-stretches them to the same duration (taking the longest as basis), and layers them together to create a unique audio experience.

Heavily inspired by [Every Recording of Gymnopédie 1](https://slownames.bandcamp.com/album/every-recording-of-gymnop-die-1).

## Features

- Download top cover versions of a song from YouTube
- Time-stretch audio files to match the longest duration
- Layer multiple audio files into a single output
- Customizable number of covers to download and keyword exclusions

## Dependencies

- Node.js
- ffmpeg
- yt-dlp
- Rubberband (MacOS ARM version included in `./lib/rubberband/`)

## Installation

1. Clone this repository
2. Install dependencies: `pnpm i`
3. Ensure ffmpeg and yt-dlp are installed and accessible in your PATH

## Usage

Run the main script with the following command:

`node main.js [options] "search query"`

### Options:

- `--download` or `-d`: Download songs first (default: false)
- `--number` or `-n`: Number of covers to download (default: 5)
- `--exclude` or `-e`: Comma-separated list of keywords to exclude from search (e.g `guitar,drums`)

### Example:

`node main.js --download --number 3 --exclude "guitar,🎸" "Clair de Lune"`

## Output

The processed files will be saved in the `output/` directory, organized by search query:

```
output/

  └── [search_query]/

    ├── `songs/`

    ├── `stretched_songs/`

    └── `layered_[search_query].wav`
```

## File Structure

- `main.js`: Main entry point, orchestrates the process
- `songdl.js`: Handles downloading cover versions from YouTube
- `timestretch.js`: Time-stretches audio files to match the longest duration
- `layerer.js`: Layers the time-stretched audio files into a single output

## Troubleshooting

This tool does not promise a consonant result. To improve output quality, you can try the following:

- check the downloaded songs for artifacts at the beginning and end of the file (e.g applause, vocals, etc.). remove these songs before timestretching and layering. (can run the tool again without the --download option)
- check the length of the downloaded songs. remove outliers (e.g much shorter or longer)