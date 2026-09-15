import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getPref, setPref } from "../preferences";

/**
 * Port of Sources/Sharing/R2Uploader.swift + R2SigV4 + R2CredentialStore.
 * Hand-rolled AWS SigV4 for Cloudflare R2 — no AWS SDK.
 */

export interface R2Credentials {
  accountID: string;
  bucket: string;
  publicBaseURL: string;
  accessKeyID: string;
  secretAccessKey: string;
}

export function getR2Credentials(): R2Credentials {
  return {
    accountID: getPref("r2AccountID") || "",
    bucket: getPref("r2Bucket") || "",
    publicBaseURL: (getPref("r2PublicBaseURL") || "").replace(/\/$/, ""),
    accessKeyID: getPref("r2AccessKeyID") || "",
    secretAccessKey: getPref("r2SecretAccessKey") || "",
  };
}

export function setR2Credentials(creds: Partial<R2Credentials>) {
  if (creds.accountID != null) setPref("r2AccountID", creds.accountID);
  if (creds.bucket != null) setPref("r2Bucket", creds.bucket);
  if (creds.publicBaseURL != null) setPref("r2PublicBaseURL", creds.publicBaseURL);
  if (creds.accessKeyID != null) setPref("r2AccessKeyID", creds.accessKeyID);
  if (creds.secretAccessKey != null) setPref("r2SecretAccessKey", creds.secretAccessKey);
}

export function isR2Configured(creds = getR2Credentials()): boolean {
  return Boolean(
    creds.accountID && creds.bucket && creds.publicBaseURL &&
    creds.accessKeyID && creds.secretAccessKey,
  );
}

const REGION = "auto";
const SERVICE = "s3";
const ALGORITHM = "AWS4-HMAC-SHA256";
const UNSIGNED = "UNSIGNED-PAYLOAD";

function hmac(key: Buffer | string, message: string): Buffer {
  return crypto.createHmac("sha256", key).update(message, "utf8").digest();
}

function sha256Hex(message: string): string {
  return crypto.createHash("sha256").update(message, "utf8").digest("hex");
}

function uriEncodePath(segment: string): string {
  return segment.split("/").map((p) => encodeURIComponent(p)).join("/");
}

function formattedDates(date = new Date()): { dateStamp: string; amzDate: string } {
  const iso = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  // 20260315T123456Z
  return { dateStamp: iso.slice(0, 8), amzDate: iso };
}

export function signR2(opts: {
  method: string;
  host: string;
  canonicalURI: string;
  accessKeyID: string;
  secretAccessKey: string;
  contentType: string;
  date?: Date;
}): { amzDate: string; contentSHA256: string; authorizationHeader: string } {
  const { dateStamp, amzDate } = formattedDates(opts.date);
  const payloadHash = UNSIGNED;
  const headerLines = [
    `content-type:${opts.contentType}`,
    `host:${opts.host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
  ];
  const canonicalHeaders = headerLines.map((l) => `${l}\n`).join("");
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    opts.method,
    opts.canonicalURI,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [
    ALGORITHM,
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const kDate = hmac(`AWS4${opts.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  const authorizationHeader =
    `${ALGORITHM} Credential=${opts.accessKeyID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { amzDate, contentSHA256: payloadHash, authorizationHeader };
}

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".json") return "application/json";
  return "application/octet-stream";
}

async function putObject(
  creds: R2Credentials,
  objectKey: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const host = `${creds.accountID}.r2.cloudflarestorage.com`;
  const canonicalURI = `/${uriEncodePath(creds.bucket)}/${uriEncodePath(objectKey)}`;
  const url = `https://${host}${canonicalURI}`;
  const sig = signR2({
    method: "PUT",
    host,
    canonicalURI,
    accessKeyID: creds.accessKeyID,
    secretAccessKey: creds.secretAccessKey,
    contentType,
  });
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "x-amz-date": sig.amzDate,
      "x-amz-content-sha256": sig.contentSHA256,
      Authorization: sig.authorizationHeader,
      "Content-Length": String(body.length),
    },
    body: new Uint8Array(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`R2 upload failed (${res.status}): ${text.slice(0, 200) || res.statusText}`);
  }
}

/** Upload a capture and return the public share URL. */
export async function uploadShare(filePath: string): Promise<string> {
  const creds = getR2Credentials();
  if (!isR2Configured(creds)) {
    throw new Error("R2 sharing is not configured. Add your credentials in Settings > Sharing.");
  }
  if (!fs.existsSync(filePath)) throw new Error("File not found for upload.");

  const slug = randomUUID().replace(/-/g, "").slice(0, 12);
  const ext = path.extname(filePath) || ".png";
  const mediaKey = `shares/${slug}/media${ext}`;
  const body = fs.readFileSync(filePath);
  await putObject(creds, mediaKey, body, contentTypeFor(filePath));

  const manifest = {
    version: 1,
    title: path.basename(filePath),
    media: `media${ext}`,
    createdAt: new Date().toISOString(),
  };
  await putObject(
    creds,
    `shares/${slug}/manifest.json`,
    Buffer.from(JSON.stringify(manifest), "utf8"),
    "application/json",
  );

  return `${creds.publicBaseURL}/${slug}`;
}

export async function testR2Connection(creds = getR2Credentials()): Promise<void> {
  if (!isR2Configured(creds)) throw new Error("Fill in all fields before testing.");
  const host = `${creds.accountID}.r2.cloudflarestorage.com`;
  const probeKey = "reflecto-connection-probe";
  const canonicalURI = `/${uriEncodePath(creds.bucket)}/${uriEncodePath(probeKey)}`;
  const url = `https://${host}${canonicalURI}`;
  const contentType = "application/octet-stream";
  const sig = signR2({
    method: "GET",
    host,
    canonicalURI,
    accessKeyID: creds.accessKeyID,
    secretAccessKey: creds.secretAccessKey,
    contentType,
  });
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": contentType,
      "x-amz-date": sig.amzDate,
      "x-amz-content-sha256": sig.contentSHA256,
      Authorization: sig.authorizationHeader,
    },
  });
  // 404 means auth worked but object missing — that's a successful probe.
  if (res.status === 404 || res.ok) return;
  const text = await res.text().catch(() => "");
  throw new Error(`R2 connection failed (${res.status}): ${text.slice(0, 200) || res.statusText}`);
}
