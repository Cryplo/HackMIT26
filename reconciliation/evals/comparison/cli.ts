import { main } from './run';
main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Benchmark failed.');
  process.exitCode = 2;
});
