#!/usr/bin/env node

import { runCli } from "./cli-runner";

runCli().then((exitCode) => {
  process.exitCode = exitCode;
});
