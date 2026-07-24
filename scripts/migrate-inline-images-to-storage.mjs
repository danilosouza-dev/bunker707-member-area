import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const bucket = "content-assets";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const supportedTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"]
]);

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Supabase nao configurado para migrar as imagens.");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const bucketResult = await supabase.storage.getBucket(bucket);

if (bucketResult.error) {
  const createBucketResult = await supabase.storage.createBucket(bucket, {
    allowedMimeTypes: Array.from(supportedTypes.keys()),
    fileSizeLimit: 8 * 1024 * 1024,
    public: true
  });

  if (createBucketResult.error && !/already exists|duplicate/i.test(createBucketResult.error.message)) {
    throw new Error(`Nao foi possivel criar o bucket ${bucket}: ${createBucketResult.error.message}`);
  }
} else if (!bucketResult.data.public) {
  const updateBucketResult = await supabase.storage.updateBucket(bucket, {
    allowedMimeTypes: Array.from(supportedTypes.keys()),
    fileSizeLimit: 8 * 1024 * 1024,
    public: true
  });

  if (updateBucketResult.error) {
    throw new Error(`Nao foi possivel atualizar o bucket ${bucket}: ${updateBucketResult.error.message}`);
  }
}

function parseDataUrl(value) {
  const match = /^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i.exec(value ?? "");

  if (!match) return null;

  const mimeType = match[1].toLowerCase();
  const extension = supportedTypes.get(mimeType);

  if (!extension) {
    throw new Error(`Formato nao suportado durante a migracao: ${mimeType}`);
  }

  return {
    bytes: Buffer.from(match[2].replace(/\s+/g, ""), "base64"),
    extension,
    mimeType
  };
}

function safeSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "asset";
}

async function uploadDataUrl(value, ownerPath) {
  const parsed = parseDataUrl(value);

  if (!parsed) return value;

  const hash = createHash("sha256").update(parsed.bytes).digest("hex").slice(0, 24);
  const objectPath = `${ownerPath.split("/").map(safeSegment).join("/")}/${hash}.${parsed.extension}`;
  const upload = await supabase.storage.from(bucket).upload(objectPath, parsed.bytes, {
    cacheControl: "31536000",
    contentType: parsed.mimeType,
    upsert: false
  });

  if (upload.error && !/already exists|duplicate/i.test(upload.error.message)) {
    throw new Error(`Falha enviando ${objectPath}: ${upload.error.message}`);
  }

  return supabase.storage.from(bucket).getPublicUrl(objectPath).data.publicUrl;
}

async function migrateColumn({ table, column, ownerPath }) {
  const result = await supabase.from(table).select(`id,${column}`);

  if (result.error) throw result.error;

  let migrated = 0;
  let bytesRemoved = 0;

  for (const row of result.data ?? []) {
    const currentValue = row[column];

    if (typeof currentValue !== "string" || !currentValue.startsWith("data:image/")) continue;

    const nextValue = await uploadDataUrl(currentValue, ownerPath(row));
    const update = await supabase.from(table).update({ [column]: nextValue }).eq("id", row.id);

    if (update.error) throw update.error;

    migrated += 1;
    bytesRemoved += Buffer.byteLength(currentValue);
  }

  return { bytesRemoved, migrated, table };
}

const results = [];
results.push(await migrateColumn({
  table: "content_items",
  column: "image",
  ownerPath: (row) => `content/${row.id}/cover`
}));
results.push(await migrateColumn({
  table: "course_modules",
  column: "image",
  ownerPath: (row) => `modules/${row.id}/cover`
}));
results.push(await migrateColumn({
  table: "lessons",
  column: "image",
  ownerPath: (row) => `lessons/${row.id}/thumbnail`
}));

console.log(JSON.stringify({ results }, null, 2));
