import { acceptFunctionRequest, parseRequestBody } from "./accept-function-request";
import { functions, functionServices } from "./index";
import { runFunction } from "./run-function";

/**
 * The entry points the Python wrapper in modal_app.py runs in Node:
 *   accept <function>, with the Authorization header in FUNCTION_AUTHORIZATION and the JSON request body in
 *     FUNCTION_BODY, claims the work and prints the response as JSON.
 *   run <function> <runId> [applicationId] does the work and records how it ended.
 *   scheduled <function> claims a run and does the work, for the Modal schedule. It does nothing if one is active,
 *     or if the Function's schedule is turned off in Settings.
 */
async function main() {
  const [command, functionName, runId, applicationId] = process.argv.slice(2);

  const definition = functions.get(functionName);
  if (!definition) throw new Error(`Unknown Function: ${functionName}`);

  const { timeLimitMs } = definition;
  const services = functionServices();
  const work = () => definition.work(services, applicationId ? Number(applicationId) : undefined);

  if (command === "accept") {
    const authorization = process.env.FUNCTION_AUTHORIZATION;
    const body = parseRequestBody(process.env.FUNCTION_BODY);
    const claim = definition.claim;
    // Modal spawns the Function once this returns, so there is nothing to start here.
    const result = await acceptFunctionRequest(
      { functionName, timeLimitMs, authorization, body },
      { ...services, start: () => {}, claim: claim && ((body) => claim(services, body)) },
    );
    console.log(JSON.stringify(result));
  } else if (command === "run") {
    await runFunction(Number(runId), functionName, work, services);
  } else if (command === "scheduled") {
    if (definition.scheduled && !(await definition.scheduled(services))) {
      console.log("The schedule is turned off in Settings, so nothing runs.");
      return;
    }
    const claimed = await services.runs.start(functionName, services.now(), timeLimitMs);
    if (claimed !== null) await runFunction(claimed, functionName, work, services);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
