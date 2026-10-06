export type FacingMode = 'user' | 'environment';

export type CameraErrorKind = 'denied' | 'no-camera' | 'in-use' | 'insecure' | 'unsupported' | 'unknown';

export class CameraError extends Error {
  constructor(
    public kind: CameraErrorKind,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Opens the camera. Video only — no audio, nothing is recorded or uploaded.
 * `facingMode` is a preference (`ideal`), so desktops with one webcam still work.
 */
export async function openCamera(facingMode: FacingMode): Promise<MediaStream> {
  if (!window.isSecureContext) {
    throw new CameraError('insecure', 'Camera access needs HTTPS (or localhost).');
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError('unsupported', 'This browser does not support camera access.');
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: facingMode },
        // 720p is plenty for pose estimation and keeps phones cool.
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 60 },
      },
    });
  } catch (err) {
    throw toCameraError(err);
  }
}

export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Only meaningful after permission is granted (labels/devices are hidden before). */
export async function countCameras(): Promise<number> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput').length;
  } catch {
    return 1;
  }
}

/** Which way the opened camera actually faces (desktop webcams usually report nothing → treat as user-facing). */
export function actualFacing(stream: MediaStream, requested: FacingMode): FacingMode {
  const settings = stream.getVideoTracks()[0]?.getSettings();
  const facing = settings?.facingMode;
  if (facing === 'user' || facing === 'environment') return facing;
  // No facing info (typical laptop webcam): it faces the user.
  return requested === 'environment' && /Android|iPhone|iPad/i.test(navigator.userAgent) ? 'environment' : 'user';
}

function toCameraError(err: unknown): CameraError {
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CameraError('denied', 'Camera permission was denied.');
    case 'NotFoundError':
    case 'OverconstrainedError':
    case 'DevicesNotFoundError':
      return new CameraError('no-camera', 'No camera was found on this device.');
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return new CameraError('in-use', 'The camera is being used by another app.');
    default:
      return new CameraError('unknown', err instanceof Error ? err.message : 'Could not start the camera.');
  }
}
