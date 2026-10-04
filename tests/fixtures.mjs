import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const dir = path.resolve('tests/fixtures');
await mkdir(dir, { recursive: true });
function ffmpeg(args) { execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'pipe' }); }
ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '24', '-c:a', 'aac', '-movflags', '+faststart', `${dir}/combined.mp4`]);
ffmpeg(['-i', `${dir}/combined.mp4`, '-map', '0:v', '-c', 'copy', `${dir}/video.mp4`]);
ffmpeg(['-i', `${dir}/combined.mp4`, '-map', '0:v', '-c', 'copy', '-movflags', '+faststart', `${dir}/video-faststart.mp4`]);
ffmpeg(['-i', `${dir}/combined.mp4`, '-map', '0:a', '-c', 'copy', `${dir}/audio.m4a`]);
ffmpeg(['-i', `${dir}/combined.mp4`, '-vf', 'scale=320:180', '-c:v', 'libx264', '-g', '24', '-c:a', 'copy', '-movflags', '+faststart', `${dir}/low.mp4`]);
ffmpeg(['-i', `${dir}/combined.mp4`, '-c', 'copy', '-f', 'hls', '-hls_time', '1', '-hls_playlist_type', 'vod', `${dir}/high.m3u8`]);
ffmpeg(['-i', `${dir}/low.mp4`, '-c', 'copy', '-f', 'hls', '-hls_time', '1', '-hls_playlist_type', 'vod', `${dir}/low.m3u8`]);
ffmpeg(['-i', `${dir}/combined.mp4`, '-c', 'copy', '-f', 'dash', '-seg_duration', '1', '-use_template', '1', '-use_timeline', '1', `${dir}/manifest.mpd`]);
ffmpeg(['-i', `${dir}/combined.mp4`, '-frames:v', '1', `${dir}/poster.png`]);
await copyFile(`${dir}/combined.mp4`, `${dir}/signed.mp4`);
await writeFile(`${dir}/master.m3u8`, '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=640x360,CODECS="avc1.64001e,mp4a.40.2"\nhigh.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=320x180,CODECS="avc1.64000c,mp4a.40.2"\nlow.m3u8\n');
console.log('Generated direct, separate-track, HLS, DASH, and signed-request fixtures.');
