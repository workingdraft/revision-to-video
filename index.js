const fs = require("fs").promises;
const rimraf = require("rimraf");
const { execSync } = require("child_process");
const fetch = require("node-fetch");
const parser = new (require("rss-parser"))();
const { createCanvas, loadImage } = require("canvas");
const { Command } = require("commander");

async function getFeedItem(i) {
  console.log("Reading feed...");
  const feed = await parser.parseURL("https://workingdraft.de/feed/");
  console.log(`Proceeding with feed item "${feed.items[i].title}"...`);
  return { title: feed.items[i].title, url: feed.items[i].enclosure.url };
}

async function downloadAudio({ title, url }) {
  console.log(`Downloading audio...`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Got status ${response.status} while fetching audio`);
  }
  const audioFile = `tmp/${title}.mp3`;
  await fs.writeFile(audioFile, await response.buffer());
  return audioFile;
}

function parseTitle(title) {
  const match = /^Revision ([0-9]+)(?::(.+))?/.exec(title);
  if (!match) {
    console.warn(
      `WARNING: Unable to parse title "${title}", check if generated thumbnail is ok`
    );
    return { nr: -1, text: null };
  }
  return { nr: match[1], text: match[2] };
}

async function generateThumbnail(title) {
  console.log(`Rendering thumbnail...`);
  const { nr, text } = parseTitle(title);
  const tagText = nr > -1 ? `#${nr}` : `#spezial`;
  const subText = nr === -1 || !text ? title : text;
  const image = await loadImage("img/video.png");
  const maxTextWidth = image.width - 2 * 250;
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  ctx.font = "bold 400px Source Sans Pro";
  ctx.textAlign = "left";
  ctx.fillStyle = "#910c69";
  ctx.strokeStyle = "#FFF";
  ctx.lineWidth = 80;
  ctx.strokeText(tagText, 250, canvas.height - 400);
  ctx.fillText(tagText, 250, canvas.height - 400);
  ctx.font = "bold 200px Source Sans Pro";
  ctx.lineWidth = 40;
  ctx.strokeText(subText, 250, canvas.height - 150, maxTextWidth);
  ctx.fillText(subText, 250, canvas.height - 150, maxTextWidth);
  const thumbnailFile = `tmp/${title}.png`;
  await fs.writeFile(thumbnailFile, canvas.toBuffer("image/png"));
  return thumbnailFile;
}

function encode(title, audioFile, thumbnailFile) {
  const videoFile = `out/${title}.mov`;
  console.log(`Encoding "${videoFile}". This will take some time...`);
  execSync(
    `ffmpeg -loop 1 -i "${thumbnailFile}" -i "${audioFile}" -tune stillimage -c:a aac -b:a 192k -pix_fmt yuv420p -shortest -preset ultrafast "${videoFile}" > log.txt`
  );
  return videoFile;
}

function parseArguments() {
  const program = new Command();

  program.version("1.0.0");

  program
    .option("-r, --revision", "Revisions-Eintrag")
    .option("-t, --thumbnail <title>", "Generate a thumbnail only")
    .option(
      "-e, --entry <entry>",
      "Welchen Eintrag im RSS Feed (0 = Letzte)",
      0
    )
    .option("-k, --keep", "Outputverzeichnisse löschen", false)
    .option("-h, --help", "Hilfe!")
    .option(
      "-m, --manual <entry...>",
      'Manual processing. Pass audio file and title, e.g -m test.mp3 "Last Episode"'
    );

  program.parse(process.argv);

  if (program.opts().help) {
    program.outputHelp();
    process.exit(0);
  }

  return program.opts();
}

async function manual(options) {
  if (options.manual.length !== 2) {
    console.log("Insufficient number of arguments");
    process.exit(1);
  }
  const [audioFile, title] = options.manual;
  const thumbnailFile = await generateThumbnail(title);

  return [audioFile, thumbnailFile, title];
}

async function feed(options) {
  const { url, title } = await getFeedItem(parseInt(options.entry));
  const [audioFile, thumbnailFile] = await Promise.all([
    downloadAudio({ url, title }),
    generateThumbnail(title),
  ]);

  return [audioFile, thumbnailFile, title];
}

async function main() {
  const options = parseArguments();
  console.log(options);

  if (options.thumbnail) {
    await generateThumbnail(options.thumbnail);
    console.log(`Thumbnail rendered at ./tmp/${options.thumbnail}.png`);
  }

  if (!options.keep) {
    rimraf.sync("out/*");
    rimraf.sync("tmp/*");
  }

  // create something from disk (manual) or from the feed
  let fn = options.manual ? manual : feed;

  const [audioFile, thumbnailFile, title] = await fn(options);

  const videoFile = encode(title, audioFile, thumbnailFile);
  return videoFile;
}

main().then((videoFile) => {
  console.log(
    `Done! Now upload "${videoFile}" to https://studio.youtube.com/channel/UCTJTfsq21-sC6maSTzifiPQ/videos/upload?d=ud`
  );
});
