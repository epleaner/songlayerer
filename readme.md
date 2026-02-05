# Song Layerer

This project is a Node.js-based tool that allows for experimental audio generation, by time-stretches collections of tracks to the same duration (taking the longest as basis), and layers them together.

Inspired by [Every Recording of Gymnopédie 1](https://slownames.bandcamp.com/album/every-recording-of-gymnop-die-1).

## Features

- Download top N search results from YouTube
- Use self-selected audio files as input
- Time-stretch audio files to match the longest duration
- Layer multiple audio files into a single output

## Dependencies

- Node.js
- ffmpeg
- yt-dlp
- Rubberband (MacOS ARM version included in `./lib/rubberband/`)

### yt-dlp Notes

YouTube frequently breaks older `yt-dlp` builds. If downloads fail with messages like **"Signature extraction failed"**, **HTTP 403**, or **"Only images are available"**, update `yt-dlp` (macOS: `brew upgrade yt-dlp`).

If YouTube is rate-limiting or blocking your IP, you may need cookies. This tool supports:

- `YTDLP_COOKIES_FROM_BROWSER=chrome` (or `firefox`, etc.)
- `YTDLP_COOKIES=/path/to/cookies.txt`

## Installation

1. Clone this repository
2. Install dependencies: `pnpm i`
3. Ensure ffmpeg and yt-dlp are installed and accessible in your PATH

## Usage

Run the main script with the following command:

`node main.js [options] "search query"`

### Options:

- `--download` or `-d`: Download songs from YT first (default: false)
- `--number` or `-n`: Number of songs to download (default: 5)
- `--exclude` or `-e`: Comma-separated list of keywords to exclude from search (e.g `guitar,drums`)

### Example:

`node main.js -d -n 3 -e "guitar,🎸" "Clair de Lune"`

### Alternative usage:

Manually populate the `output/[search_query]/songs/` directory with audio files, and run `node main.js "search query"`. This skips the download step.

## UI (React)

This repo includes a tiny local UI (Vite + React + Tailwind + shadcn/ui).

- Dev: `pnpm dev` then open `http://localhost:5173`
- Prod build: `pnpm build` then `pnpm start` (serves UI + API on `http://localhost:5174`)

## Output

The processed files will be saved in the `output/` directory, organized by search query:

```
output/

  └── [search_query]/

    ├── `songs/`

    ├── `stretched_songs/`

    └── `layered_[sanitized_search_query].wav`
```

## File Structure

- `main.js`: Main entry point, orchestrates the process
- `songdl.js`: Handles downloading cover versions from YouTube
- `timestretch.js`: Time-stretches audio files to match the longest duration
- `layerer.js`: Layers the time-stretched audio files into a single output

## Troubleshooting

This tool does not promise a consonant result. To improve output quality, you can try the following:

- check the downloaded songs for artifacts at the beginning and end of the file (e.g applause, vocals, etc.). remove these songs.
- check the length of the downloaded songs. remove outliers (e.g much shorter or longer)

Once you have a good set of songs, you can run the tool without the `--download` option to skip the download step.
