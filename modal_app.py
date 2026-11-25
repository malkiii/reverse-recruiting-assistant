"""Thin Modal wrapper. All logic stays in TypeScript, see src/functions/cli.ts."""

import json
import os
import subprocess

import modal

APP_DIR = "/app"
CLI = ["npx", "tsx", "src/functions/cli.ts"]
COLLECT_JOBS_TIMEOUT = 30 * 60  # COLLECTION_TIME_LIMIT_MS in src/lib/job-collection.ts
PREPARE_APPLICATION_TIMEOUT = 30 * 60  # PREPARE_TIME_LIMIT_MS in src/lib/application-lifecycle.ts
SEND_APPLICATION_TIMEOUT = 10 * 60  # SEND_TIME_LIMIT_MS in src/lib/application-lifecycle.ts
CHECK_REPLIES_TIMEOUT = 10 * 60  # REPLY_CHECK_TIME_LIMIT_MS in src/lib/reply-check.ts
# Read where `modal deploy` runs, because Modal resolves schedules at deploy time.
TIMEZONE = os.environ.get("TIMEZONE") or "UTC"

image = modal.Image.from_dockerfile("Dockerfile", add_python="3.12").pip_install("fastapi[standard]")
secrets = [modal.Secret.from_name("reverse-recruiting-agent")]
app = modal.App("reverse-recruiting-agent", image=image, secrets=secrets)


@app.function(timeout=60)
def noop(run_id: int):
    subprocess.run([*CLI, "run", "noop", str(run_id)], cwd=APP_DIR, check=True)


@app.function(timeout=COLLECT_JOBS_TIMEOUT)
def collect_jobs(run_id: int):
    subprocess.run([*CLI, "run", "collect-jobs", str(run_id)], cwd=APP_DIR, check=True)


@app.function(timeout=PREPARE_APPLICATION_TIMEOUT)
def prepare_application(run_id: int, application_id: int):
    subprocess.run(
        [*CLI, "run", "prepare-application", str(run_id), str(application_id)], cwd=APP_DIR, check=True
    )


@app.function(timeout=SEND_APPLICATION_TIMEOUT)
def send_application(run_id: int, application_id: int):
    subprocess.run([*CLI, "run", "send-application", str(run_id), str(application_id)], cwd=APP_DIR, check=True)


# Job Collection keeps only Jobs posted today, so earlier runs see fewer of them.
# It always fires; the CLI does nothing unless the schedule is turned on in Settings.
@app.function(timeout=COLLECT_JOBS_TIMEOUT, schedule=modal.Cron("0 10 * * *", timezone=TIMEZONE))
def scheduled_collect_jobs():
    subprocess.run([*CLI, "scheduled", "collect-jobs"], cwd=APP_DIR, check=True)


# The Reply Check reads the Gmail threads of emails sent in the last 30 days for new replies.
@app.function(timeout=CHECK_REPLIES_TIMEOUT, schedule=modal.Cron("0 * * * *", timezone=TIMEZONE))
def scheduled_check_replies():
    subprocess.run([*CLI, "scheduled", "check-replies"], cwd=APP_DIR, check=True)


@app.function()
@modal.asgi_app()
def web():
    from fastapi import FastAPI, Header, Request
    from fastapi.concurrency import run_in_threadpool
    from fastapi.responses import JSONResponse

    api = FastAPI()

    def accept(function_name: str, function: modal.Function, authorization: str | None, body: bytes = b""):
        env = {
            **os.environ,
            "FUNCTION_AUTHORIZATION": authorization or "",
            "FUNCTION_BODY": body.decode("utf-8", errors="replace"),
        }
        output = subprocess.run(
            [*CLI, "accept", function_name], cwd=APP_DIR, env=env, check=True, stdout=subprocess.PIPE, text=True
        ).stdout
        result = json.loads(output.strip().splitlines()[-1])
        if result["status"] == 202:
            if "applicationId" in result:
                function.spawn(result["runId"], result["applicationId"])
            else:
                function.spawn(result["runId"])
        return JSONResponse(result, status_code=result["status"])

    @api.post("/functions/noop")
    def start_noop(authorization: str | None = Header(default=None)):
        return accept("noop", noop, authorization)

    @api.post("/functions/collect-jobs")
    def start_collect_jobs(authorization: str | None = Header(default=None)):
        return accept("collect-jobs", collect_jobs, authorization)

    @api.post("/functions/prepare-application")
    async def start_prepare_application(request: Request, authorization: str | None = Header(default=None)):
        body = await request.body()
        # The body can only be read in an async route, so the blocking accept runs in a thread like the others.
        return await run_in_threadpool(accept, "prepare-application", prepare_application, authorization, body)

    @api.post("/functions/send-application")
    async def start_send_application(request: Request, authorization: str | None = Header(default=None)):
        body = await request.body()
        return await run_in_threadpool(accept, "send-application", send_application, authorization, body)

    return api
