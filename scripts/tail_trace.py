"""Copy the deployed worker's model calls into logs/trace.jsonl while this runs.

    python scripts/tail_trace.py              # stop with Ctrl+C

It runs `wrangler tail` from web/node_modules, so run `npm install` in web/ first, and once
`npx wrangler login` there with the Cloudflare account that deployed the worker.
The worker stores nothing: only calls made while this runs reach the file. The lines hold the
exam text teachers pasted, so logs/ stays out of git.
"""

import argparse
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from aleph.trace import TraceLog, tail_events, worker_lines  # noqa: E402

WRANGLER = ROOT / "web/node_modules/wrangler/bin/wrangler.js"


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--worker", default="aleph", help="워커 이름(web/wrangler.jsonc의 name)")
    args = parser.parse_args()

    node = shutil.which("node")
    if node is None or not WRANGLER.is_file():
        sys.exit("node와 wrangler가 필요합니다. web/에서 npm install을 먼저 하세요.")
    log = TraceLog(ROOT / "logs/trace.jsonl")
    print(f"{args.worker} 워커의 모델 호출을 {log.path.relative_to(ROOT)}에 붙입니다. 멈추려면 Ctrl+C.")
    process = subprocess.Popen([node, str(WRANGLER), "tail", args.worker, "--format", "json"],
                               cwd=ROOT / "web", stdout=subprocess.PIPE, text=True,
                               encoding="utf-8", errors="replace")
    stopped = False
    try:
        for event in tail_events(process.stdout):
            for line in worker_lines(event):
                log.write(line)
                print(f"{line['ts']}  {line['trace_id'] or '-'}  {line['prompt'] or '-'}  "
                      f"{line['status']}{' ' + line['error'] if line['error'] else ''}  "
                      f"{line['ms']}ms")
    except KeyboardInterrupt:
        stopped = True
    finally:
        process.terminate()
    code = process.wait()
    if not stopped and code:
        sys.exit(f"wrangler tail이 코드 {code}로 끝났습니다. web/에서 npx wrangler login을 했는지 확인하세요.")


if __name__ == "__main__":
    main()
