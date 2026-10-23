import { runBuild } from './build-lib.mjs';

const cancellation = new AbortController();
const cancel = (signal) => {
  if (!cancellation.signal.aborted) {
    console.error(`收到 ${signal}，正在停止编译并清理构建目录…`);
    cancellation.abort(signal);
  }
};
const interrupt = () => cancel('SIGINT');
const terminate = () => cancel('SIGTERM');
process.on('SIGINT', interrupt);
process.on('SIGTERM', terminate);

try {
  const distDir = await runBuild(process.argv.slice(2), { signal: cancellation.signal });
  console.log(`构建完成：${distDir}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', terminate);
  if (cancellation.signal.aborted) process.exitCode = cancellation.signal.reason === 'SIGINT' ? 130 : 143;
}
