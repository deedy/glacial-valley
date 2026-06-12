#!/usr/bin/env python3
"""
Viral demo video for the procedural glacial valley.
Voiceover (ElevenLabs Chris) + ambient cinematic music + burned-in captions
with fade-in + subtle Ken Burns zoom + @deedydas end watermark.
"""

import json
import os
import subprocess
import tempfile
from pathlib import Path

import requests
from dotenv import load_dotenv
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

ELEVENLABS_API_KEY = os.environ["ELEVENLABS_API_KEY"]
ELEVENLABS_VOICE_ID = "iP95p4xoKVk53GoZ742B"  # Chris — natural, conversational
SOURCE_VIDEO = ROOT / "demo-scene.mov"
OUTPUT_VIDEO = ROOT / "demo-final.mp4"
FPS = 30
OUT_W, OUT_H = 1920, 966   # downscaled from 3410x1718, same aspect
HANDLE = "@deedydas"

# Approved script — timed to the footage (sunrise pan → snow wall → river → grass → sun)
SCRIPT_SEGMENTS = [
    {"text": "This world is running\nlive in my browser.", "duration": 2.6},
    {"text": "No game engine. No textures.\nNo 3D models.", "duration": 3.2},
    {"text": "Every mountain is math.", "duration": 1.7},
    {"text": "Noise functions, stacked until\nrock looks like rock.", "duration": 3.1},
    {"text": "The water's a real shader.", "duration": 1.8},
    {"text": "Refraction. Caustics.\nWhitewater.", "duration": 2.6},
    {"text": "The grass bends\nto a wind field.", "duration": 2.1},
    {"text": "The birds are\nfive lines of code.", "duration": 2.1},
    {"text": "Three.js and a few days\nof vibe-coding.", "duration": 2.6},
    {"text": "I shipped a sunrise.\nLink below.", "duration": 2.4},
]

FULL_SCRIPT = " ".join(seg["text"].replace("\n", " ") for seg in SCRIPT_SEGMENTS)

MUSIC_PROMPT = (
    "cinematic ambient electronic music, warm soft pads, gentle airy build, "
    "minimal piano notes, serene and premium, film score underscore"
)


def generate_voiceover(text: str, output_path: Path) -> None:
    print(f"Generating voiceover ({len(text)} chars)...")
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{ELEVENLABS_VOICE_ID}"
    headers = {"xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json"}
    payload = {
        "text": text,
        "model_id": "eleven_turbo_v2_5",
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.8,
            "style": 0.3,
            "use_speaker_boost": True,
        },
    }
    resp = requests.post(url, json=payload, headers=headers, stream=True, timeout=120)
    resp.raise_for_status()
    with open(output_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=4096):
            f.write(chunk)


def generate_background_music(output_path: Path, duration: float) -> None:
    print(f"Generating background music ({duration:.1f}s)...")
    url = "https://api.elevenlabs.io/v1/sound-generation"
    headers = {"xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json"}
    payload = {"text": MUSIC_PROMPT, "duration_seconds": min(duration, 30.0)}
    resp = requests.post(url, json=payload, headers=headers, stream=True, timeout=180)
    resp.raise_for_status()
    with open(output_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=4096):
            f.write(chunk)


def get_audio_duration(path: Path) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", str(path)],
        capture_output=True, text=True,
    )
    return float(json.loads(result.stdout)["format"]["duration"])


def mix_audio(voice: Path, music: Path, output: Path, duration: float) -> None:
    print("Mixing voiceover + music...")
    cmd = [
        "ffmpeg", "-y",
        "-i", str(voice),
        "-i", str(music),
        "-filter_complex",
        (
            f"[1:a]volume=0.15,afade=t=in:st=0:d=1,afade=t=out:st={duration - 2.5}:d=2.5[music];"
            f"[0:a]volume=1.0[voice];"
            f"[voice][music]amix=inputs=2:duration=longest:dropout_transition=2[out]"
        ),
        "-map", "[out]",
        "-c:a", "aac", "-b:a", "192k",
        "-t", str(duration),
        str(output),
    ]
    subprocess.run(cmd, check=True, capture_output=True)


def find_font() -> str:
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/Library/Fonts/Arial Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return "/System/Library/Fonts/Helvetica.ttc"


def render_caption_overlay(text: str, width: int, height: int) -> Image.Image:
    overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    font = ImageFont.truetype(find_font(), 66)

    bbox = draw.multiline_textbbox((0, 0), text, font=font, align="center", spacing=14)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]

    pad_x, pad_y = 48, 28
    box_w = text_w + pad_x * 2
    box_h = text_h + pad_y * 2
    box_x = (width - box_w) // 2
    box_y = int(height * 0.88) - box_h // 2

    draw.rounded_rectangle(
        (box_x, box_y, box_x + box_w, box_y + box_h),
        radius=28, fill=(0, 0, 0, 210),
    )
    draw.multiline_text(
        (box_x + pad_x - bbox[0], box_y + pad_y - bbox[1]),
        text, font=font, fill=(255, 255, 255, 255), align="center", spacing=14,
    )
    return overlay


def render_handle_overlay(width: int, height: int) -> Image.Image:
    overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    font = ImageFont.truetype(find_font(), 52)
    bbox = draw.textbbox((0, 0), HANDLE, font=font)
    x = width - (bbox[2] - bbox[0]) - 52
    y = 42
    draw.text((x + 2, y + 3), HANDLE, font=font, fill=(0, 0, 0, 140))      # soft shadow
    draw.text((x, y), HANDLE, font=font, fill=(255, 255, 255, 235))
    return overlay


def with_alpha(overlay: Image.Image, k: float) -> Image.Image:
    if k >= 0.999:
        return overlay
    faded = overlay.copy()
    faded.putalpha(faded.getchannel("A").point(lambda a: int(a * k)))
    return faded


def caption_at(t: float, segments, scale: float):
    """Return (text, seconds since this caption appeared) or (None, 0)."""
    elapsed = 0.0
    for seg in segments:
        seg_dur = seg["duration"] * scale
        if elapsed <= t < elapsed + seg_dur:
            return seg["text"], t - elapsed
        elapsed += seg_dur
    return None, 0.0


def ken_burns(frame: Image.Image, t: float, duration: float) -> Image.Image:
    zoom = 1.0 + 0.06 * (t / duration)
    w, h = frame.size
    cw, ch = int(w / zoom), int(h / zoom)
    x0, y0 = (w - cw) // 2, (h - ch) // 2
    return frame.crop((x0, y0, x0 + cw, y0 + ch)).resize((w, h), Image.BILINEAR)


def composite_video(source: Path, mixed_audio: Path, output: Path, segments, duration: float) -> None:
    print(f"Rendering {OUT_W}x{OUT_H} @ {FPS}fps, {duration:.1f}s")

    total_script = sum(s["duration"] for s in segments)
    scale = duration / total_script  # spread captions across the full voiceover

    caption_cache = {s["text"]: render_caption_overlay(s["text"], OUT_W, OUT_H) for s in segments}
    handle_overlay = render_handle_overlay(OUT_W, OUT_H)

    decode_cmd = [
        "ffmpeg", "-i", str(source),
        "-vf", f"fps={FPS},scale={OUT_W}:{OUT_H}",
        "-pix_fmt", "rgba", "-f", "rawvideo", "-v", "quiet",
        "pipe:1",
    ]
    encode_cmd = [
        "ffmpeg", "-y",
        "-f", "rawvideo", "-pix_fmt", "rgba",
        "-s", f"{OUT_W}x{OUT_H}", "-r", str(FPS),
        "-i", "pipe:0",
        "-i", str(mixed_audio),
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-preset", "medium", "-crf", "19",
        "-c:a", "aac", "-b:a", "192k",
        "-t", str(duration),
        "-movflags", "+faststart",
        str(output),
    ]

    frame_size = OUT_W * OUT_H * 4
    total_frames = int(duration * FPS)
    decoder = subprocess.Popen(decode_cmd, stdout=subprocess.PIPE)
    encoder = subprocess.Popen(encode_cmd, stdin=subprocess.PIPE)

    last_raw = None
    for frame_idx in range(total_frames):
        raw = decoder.stdout.read(frame_size)
        if raw and len(raw) == frame_size:
            last_raw = raw
        elif last_raw is not None:
            raw = last_raw  # hold last frame if the voiceover outruns the footage
        else:
            raw = b"\x00" * frame_size

        t = frame_idx / FPS
        frame = Image.frombytes("RGBA", (OUT_W, OUT_H), raw)
        frame = ken_burns(frame, t, duration)

        text, age = caption_at(t, segments, scale)
        if text:
            frame = Image.alpha_composite(frame, with_alpha(caption_cache[text], min(age / 0.15, 1.0)))

        fade = (t - (duration - 3.0)) / 1.0  # handle fades in over the last 3 s
        if fade > 0:
            frame = Image.alpha_composite(frame, with_alpha(handle_overlay, min(fade, 1.0)))

        encoder.stdin.write(frame.tobytes())
        if frame_idx % (FPS * 5) == 0:
            print(f"  {t:4.0f}s / {duration:.0f}s")

    encoder.stdin.close()
    decoder.stdout.close()
    decoder.wait()
    encoder.wait()
    if encoder.returncode:
        raise RuntimeError("ffmpeg encode failed")


def main():
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)
        voice_path = tmpdir / "voiceover.mp3"
        music_path = tmpdir / "music.mp3"
        mixed_path = tmpdir / "mixed.m4a"

        generate_voiceover(FULL_SCRIPT, voice_path)
        voice_dur = get_audio_duration(voice_path)
        print(f"Voiceover: {voice_dur:.2f}s")
        final_duration = voice_dur + 0.6   # small tail of breathing room

        generate_background_music(music_path, final_duration)
        mix_audio(voice_path, music_path, mixed_path, final_duration)
        composite_video(SOURCE_VIDEO, mixed_path, OUTPUT_VIDEO, SCRIPT_SEGMENTS, final_duration)

    print(f"\nDone: {OUTPUT_VIDEO}")


if __name__ == "__main__":
    main()
