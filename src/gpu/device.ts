/** Cheap synchronous check for the WebGPU entry point, used to decide whether to render or show the notice. */
export const isWebGpuSupported = (nav: Navigator = navigator): boolean =>
  typeof nav !== "undefined" && "gpu" in nav && nav.gpu != null;

/** Acquire a WebGPU device, or null when unavailable so callers fall back to the notice. */
export const acquireDevice = async (
  nav: Navigator = navigator,
): Promise<GPUDevice | null> => {
  if (!isWebGpuSupported(nav)) return null;
  try {
    const adapter = await nav.gpu.requestAdapter();
    if (!adapter) return null;
    return await adapter.requestDevice();
  } catch {
    return null;
  }
};
