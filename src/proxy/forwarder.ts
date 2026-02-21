import type { Request, Response } from 'express';

const OPENAI_PATH = '/v1/chat/completions';
const ANTHROPIC_PATH = '/v1/messages';

interface ProviderConfig {
  url: string;
  headers: Record<string, string>;
}

export interface ForwardResult {
  status: number;
  headers: Record<string, string>;
  rawResponse: string;
  latencyMs: number;
  streamed: boolean;
}

function resolveProvider(req: Request): ProviderConfig {
  if (req.path === OPENAI_PATH) {
    return {
      url: 'https://api.openai.com/v1/chat/completions',
      headers: {
        authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}`
      }
    };
  }

  if (req.path === ANTHROPIC_PATH) {
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
        'anthropic-version': '2023-06-01'
      }
    };
  }

  throw new Error(`Unsupported provider path: ${req.path}`);
}

function copyUpstreamHeaders(response: globalThis.Response): Record<string, string> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'transfer-encoding') {
      headers[key] = value;
    }
  });
  return headers;
}

function shouldStream(req: Request, headers: Record<string, string>): boolean {
  const contentType = headers['content-type'] ?? '';
  if (contentType.includes('text/event-stream')) {
    return true;
  }

  const body = req.body as Record<string, unknown> | undefined;
  return body?.stream === true;
}

export async function forwardRequest(req: Request, rawBody: string, downstreamResponse?: Response): Promise<ForwardResult> {
  const provider = resolveProvider(req);
  const startedAt = Date.now();

  const upstreamResponse = await fetch(provider.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...provider.headers
    },
    body: rawBody
  });

  const headers = copyUpstreamHeaders(upstreamResponse);
  const streamed = shouldStream(req, headers) && upstreamResponse.body !== null && downstreamResponse !== undefined;

  if (!streamed) {
    const text = await upstreamResponse.text();
    const latencyMs = Date.now() - startedAt;
    return {
      status: upstreamResponse.status,
      headers,
      rawResponse: text,
      latencyMs,
      streamed: false
    };
  }

  const bodyStream = upstreamResponse.body;
  if (bodyStream === null) {
    return {
      status: upstreamResponse.status,
      headers,
      rawResponse: '',
      latencyMs: Date.now() - startedAt,
      streamed: false
    };
  }

  downstreamResponse.status(upstreamResponse.status).set(headers);

  const reader = bodyStream.getReader();
  const chunks: Buffer[] = [];
  let firstByteAt: number | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    if (firstByteAt === null) {
      firstByteAt = Date.now();
    }

    const chunk = Buffer.from(value);
    chunks.push(chunk);
    downstreamResponse.write(chunk);
  }

  downstreamResponse.end();

  const latencyMs = (firstByteAt ?? Date.now()) - startedAt;

  return {
    status: upstreamResponse.status,
    headers,
    rawResponse: Buffer.concat(chunks).toString('utf8'),
    latencyMs,
    streamed: true
  };
}
