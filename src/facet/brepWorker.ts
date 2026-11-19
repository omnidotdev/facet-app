/// <reference lib="webworker" />

/**
 * B-rep kernel worker: runs OpenCascade evaluation and export off the main
 * thread. An OCCT rebuild of a detailed part can take seconds, and on the main
 * thread that froze input and painting for the whole build (a slider drag
 * stalled under the cursor). Here the page stays responsive and the mesh
 * arrives when it is ready.
 *
 * Unlike the sandbox worker, this one never sees model code: it receives the
 * serializable op-graph the sandbox already produced.
 */

import { loadBrepKernel } from "@/facet/brepKernel";
import { KernelError } from "@/facet/kernel";

import type { BrepRequest, BrepResponse } from "@/facet/brepWorkerClient";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const kernelReady = loadBrepKernel();

/** Hand a typed array's buffer over without a copy when the view owns all of it */
const transferable = (view: ArrayBufferView): ArrayBuffer[] =>
  view.byteOffset === 0 &&
  view.byteLength === view.buffer.byteLength &&
  view.buffer instanceof ArrayBuffer
    ? [view.buffer]
    : [];

const reply = (response: BrepResponse, transfer: ArrayBuffer[] = []) =>
  scope.postMessage(response, transfer);

scope.onmessage = async (event: MessageEvent<BrepRequest>) => {
  const request = event.data;
  const { id } = request;
  const kernel = await kernelReady;
  if (!kernel) {
    reply({
      id,
      ok: false,
      error: "The B-rep kernel could not be loaded.",
      userFacing: true,
    });
    return;
  }
  try {
    if (request.kind === "init") {
      reply({ id, ok: true });
    } else if (request.kind === "evaluate") {
      const mesh = kernel.evaluate(request.node);
      reply({ id, ok: true, mesh }, [
        ...transferable(mesh.positions),
        ...transferable(mesh.normals),
      ]);
    } else {
      const data = kernel.export(request.node, request.format);
      reply({ id, ok: true, data }, transferable(data));
    }
  } catch (err) {
    // The kernel already swaps raw OCCT failures for a generic KernelError, so
    // only a KernelError message is safe to show the user
    reply({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      userFacing: err instanceof KernelError,
    });
  }
};
