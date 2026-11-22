// node depth-worker.js models in.jpg out.png : how near each part of a picture is.
import { env, pipeline } from '@huggingface/transformers';
const [, , models, ...pairs] = process.argv;
env.localModelPath = models; env.allowRemoteModels = false;
const run = await pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', { dtype: 'fp32', device: 'cpu' });
for (let i = 0; i < pairs.length; i += 2) {
  const { depth } = await run(pairs[i]);
  await depth.save(pairs[i + 1]);
}
