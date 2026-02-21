#!/usr/bin/env python3
import json
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
LOG_PATH = ROOT / ".agents/scratchpad/pi-codex-search/2026-02-21-live-progress-counters/logs/smoke-local.jsonl"
OUT_PATH = ROOT / "demos/codex-search-progress.gif"

WIDTH = 980
HEIGHT = 560
MARGIN = 28


def load_updates(path: Path) -> list[str]:
    updates: list[str] = []
    final_summary = None

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line:
            continue

        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue

        if event.get("type") == "tool_execution_update" and event.get("toolName") == "codex_search":
            content = event.get("partialResult", {}).get("content", [])
            if not content:
                continue
            text = content[0].get("text", "").strip()
            if text and (not updates or updates[-1] != text):
                updates.append(text)

        if event.get("type") == "tool_execution_end" and event.get("toolName") == "codex_search":
            content = event.get("result", {}).get("content", [])
            if content:
                text = content[0].get("text", "").strip()
                if text:
                    final_summary = "\n".join(text.splitlines()[:7])

    if final_summary:
        updates.append("Done.\n" + final_summary)

    if not updates:
        raise RuntimeError(f"No tool_execution_update events found in {path}")

    if len(updates) > 14:
        step = max(1, len(updates) // 12)
        sampled = updates[::step]
        if sampled[-1] != updates[-1]:
            sampled.append(updates[-1])
        updates = sampled

    return updates


def terminal_frame(text: str, font: ImageFont.ImageFont) -> Image.Image:
    img = Image.new("RGB", (WIDTH, HEIGHT), (12, 14, 18))
    draw = ImageDraw.Draw(img)

    # Terminal chrome
    draw.rounded_rectangle((10, 10, WIDTH - 10, HEIGHT - 10), radius=12, fill=(19, 22, 28), outline=(46, 51, 63), width=2)
    draw.rectangle((12, 12, WIDTH - 12, 44), fill=(33, 37, 45))
    draw.text((24, 20), "pi-codex-search demo", fill=(200, 210, 226), font=font)

    y = 60
    prompt = '$ pi "Use codex_search ..."'
    draw.text((MARGIN, y), prompt, fill=(140, 214, 255), font=font)
    y += 32

    wrapped_lines: list[str] = []
    for line in text.splitlines() or [""]:
        wrapped = textwrap.wrap(line, width=64) or [""]
        wrapped_lines.extend(wrapped)

    for line in wrapped_lines:
        if y > HEIGHT - 36:
            break
        draw.text((MARGIN, y), line, fill=(201, 255, 191), font=font)
        y += 24

    return img


def main() -> None:
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    updates = load_updates(LOG_PATH)

    try:
        font = ImageFont.truetype("DejaVuSansMono.ttf", 18)
    except OSError:
        font = ImageFont.load_default()

    frames = [terminal_frame(update, font) for update in updates]

    durations = [520] * len(frames)
    durations[0] = 900
    durations[-1] = 1700

    frames[0].save(
        OUT_PATH,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        optimize=True,
    )

    print(f"wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
