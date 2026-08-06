/**
 * Audio upload validation helpers.
 *
 * Keeping these as pure functions makes them easy to unit-test without spinning
 * up Express or touching the database.
 */

export interface AudioValidationError {
  status: number;
  error: string;
}

/**
 * Validate an uploaded audio buffer before sending it to the transcription
 * service.  Returns an error descriptor when the upload is invalid, or `null`
 * when the buffer is acceptable.
 */
export function validateAudioBuffer(
  buffer: Buffer,
): AudioValidationError | null {
  if (buffer.length === 0) {
    return {
      status: 400,
      error:
        "Audio recording is empty — please speak for at least one second before stopping.",
    };
  }
  return null;
}
