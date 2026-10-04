'use strict';

const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand,
        DeleteObjectCommand, DeleteObjectsCommand, CopyObjectCommand,
        HeadObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const endpoint = process.env.S3_ENDPOINT || 'https://cn-nb1.rains3.com';
const region = process.env.S3_REGION || 'cn-nb1';
const accessKeyId = process.env.S3_ACCESS_KEY;
const secretAccessKey = process.env.S3_SECRET_KEY;
const bucket = process.env.S3_BUCKET || 'qb01';

if (!accessKeyId || !secretAccessKey) {
  // Don't throw at import time; the server will surface a clear message on first op.
}

const s3 = new S3Client({
  endpoint,
  region,
  credentials: {
    accessKeyId,
    secretAccessKey
  },
  // S3-compatible providers (RainS3, MinIO, etc.) use path-style addressing.
  forcePathStyle: true,
  // Avoid sending x-amz-sdk-checksum that some compatible services reject.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED'
});

module.exports = {
  s3,
  BUCKET: bucket,
  ENDPOINT: endpoint,
  REGION: region,
  getSignedUrl,
  ListObjectsV2Command, GetObjectCommand, PutObjectCommand,
  DeleteObjectCommand, DeleteObjectsCommand, CopyObjectCommand,
  HeadObjectCommand
};
