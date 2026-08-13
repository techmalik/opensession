// Resource route: the same access check as /files/:uploadId, but for the one case a
// signed-in screen needs a picture rather than a download, the headshot thumbnail.
//
// Only bytes that really are PNG, JPEG, WebP, or GIF are served, with the sniffed
// type rather than the uploaded one, nosniff, and a sandbox CSP. Anything else is a
// 404: there is no path here that can render attacker-supplied markup.

import type { Route } from "./+types/file.image";
import { bindings } from "../lib/db.server";
import { sniffImageType } from "../lib/image-type";
import { getFile } from "../lib/storage";
import { authorizedUpload } from "../lib/uploads.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const upload = await authorizedUpload(request, params.uploadId);

  const file = await getFile(bindings, upload.blobKey);
  if (!file) throw new Response("Not found", { status: 404 });

  const type = sniffImageType(file.data);
  if (!type) throw new Response("Not found", { status: 404 });

  return new Response(file.data, {
    headers: {
      "Content-Type": type,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "Cache-Control": "private, max-age=0",
    },
  });
}
