---
name: Image upload validation principles
description: Durable rules for accepting user images — decode don't sniff, don't trust MIME, and keep a single normalization boundary.
---

# Image upload validation principles

## Magic bytes prove the header, not that the image decodes

Signature checks alone accept truncated and corrupt uploads: a few valid header
bytes pass every byte check, then the file blows up later inside an AI vision
call or an image-processing step, where the user sees a generic failure instead
of "this file is damaged."

**Why:** a completion review rejected an implementation that validated only
signatures; its own test treated a five-byte stub as a valid JPEG.

**How to apply:** actually decode accepted images (a downscaled resize is enough
to force scanlines through the decoder and catch truncation) and reject failures
at the upload boundary. Corollary for tests: image fixtures must be real encoded
images — stub buffers of magic bytes will be correctly rejected.

## Never trust the browser's declared MIME type or the filename alone

iPhone uploads arrive labeled `image/jpeg` while carrying HEIC bytes, and just as
often arrive with an empty or `application/octet-stream` type. So: detect the
real format from bytes, but when *gating* which files are allowed to proceed,
also accept by extension — otherwise a valid photo is refused before it ever
reaches conversion.

**Why:** two separate review rejections came from this pair. One from trusting
the label, one from an allowlist that ran before conversion and dropped
empty-MIME `.heif` files.

**How to apply:** any new upload gate or vision call site.

## Keep one normalization boundary that nothing can route around

When an upload path lets the client write bytes directly to storage (signed PUT
URLs), the server never sees them at upload time. Such a path needs a separate
authenticated step that normalizes the bytes and records ownership, and reads
must be impossible until that step has run — otherwise unconverted files reach
consumers.

**Why:** an architecture review blocked a first implementation whose direct
upload path stored raw HEIC with no owner and no conversion.

**How to apply:** a new way to write objects must normalize inline or route
through the existing boundary. Services that consume image bytes should take
already-authorized, already-normalized bytes from their caller rather than
reading storage themselves.

## HEIC decoding needs a dedicated decoder

The usual image library recognizes the HEIC/HEIF container and returns metadata
for it, so support *looks* present, but it cannot decode the HEVC-coded payload
here and fails at pixel access.

**How to apply:** don't conclude HEIC works because a metadata read succeeded —
verify against a real iPhone photo.

## Unsupported or undecodable images return 415

Not 500 and not 400, consistently across upload and vision endpoints.
