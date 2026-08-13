// Resource route: streams an uploaded file.
//
// Everything here leaves as an opaque download. An upload's declared content type is
// attacker-controlled, and serving it back inline on this origin is how an "image"
// becomes same-origin HTML. Nothing on this route renders in place: the thumbnails
// signed-in screens show come from /files/:uploadId/image, which serves only bytes
// that really are one of the four raster formats.

import type { Route } from "./+types/file.download";
import { bindings } from "../lib/db.server";
import { getFile } from "../lib/storage";
import { authorizedUpload } from "../lib/uploads.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const upload = await authorizedUpload(request, params.uploadId);

  const file = await getFile(bindings, upload.blobKey);
  if (!file) throw new Response("File data missing", { status: 404 });

  return new Response(file.data, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${upload.filename.replace(/"/g, "")}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=0",
    },
  });
}
