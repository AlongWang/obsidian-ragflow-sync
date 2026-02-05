/* eslint-disable @typescript-eslint/no-base-to-string */
import {requestUrl} from "obsidian";
import {RagFlowSyncPluginSettings} from "./settings";


type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface RagflowClientConfig {
	baseUrl: string;
	apiKey: string;
	vaultName?: string;
}

interface ApiResponse<T> {
	code?: number;
	message?: string;
	data?: T;
	total?: number;
}

export interface KnowledgeBaseInput {
	name: string;
	description?: string;
}

export interface KnowledgeBase extends KnowledgeBaseInput {
	id: string;
	avatar?: string | null;
	chunk_count?: number;
	create_time?: number;
	update_time?: number;
}

export interface KnowledgeBaseFile {
	id: string;
	dataset_id: string;
	name: string;
	location?: string;
	size?: number;
	run?: string;
	status?: string;
	create_time?: number;
	update_time?: number;
}

export interface UploadFilePayload {
	fileName: string;
	data: Blob | ArrayBuffer | ArrayBufferView | string;
	mimeType?: string;
}

export interface UpdateFilePayload {
	name?: string;
	meta_fields?: Record<string, unknown>;
	chunk_method?: string;
	parser_config?: Record<string, unknown>;
	enabled?: number;
}

export class RagflowApi {
	private readonly baseUrl: string;
	private readonly apiKey: string;
	private readonly vaultName?: string;

	constructor(config: RagflowClientConfig) {
		this.baseUrl = config.baseUrl.replace(/\/+$/, "");
		this.apiKey = config.apiKey;
		this.vaultName = config.vaultName?.trim() || undefined;
	}

	async listKnowledgeBases(): Promise<KnowledgeBase[]> {
		const data = await this.request<KnowledgeBase[]>("GET", "/api/v1/datasets");
		return data ?? [];
	}

	async getKnowledgeBase(id: string): Promise<KnowledgeBase> {
		const data = await this.request<KnowledgeBase[] | KnowledgeBase>("GET", `/api/v1/datasets`, {id});
		if (Array.isArray(data) && data.length > 0) {
			const kb = data[0];
			if (!kb) {
				throw new Error("Knowledge base not found");
			}
			return kb;
		}
		if (!Array.isArray(data) && data) {
			return data;
		}
		throw new Error("Knowledge base not found");
	}

	async createKnowledgeBase(payload: KnowledgeBaseInput): Promise<KnowledgeBase> {
		const data = await this.request<KnowledgeBase>("POST", "/api/v1/datasets", payload);
		return data;
	}

	async updateKnowledgeBase(id: string, payload: Partial<KnowledgeBaseInput>): Promise<KnowledgeBase> {
		await this.request<unknown>("PUT", `/api/v1/datasets/${id}`, payload);
		return this.getKnowledgeBase(id);
	}

	async deleteKnowledgeBase(id: string): Promise<void> {
		await this.request<unknown>("DELETE", "/api/v1/datasets", {ids: [id]});
	}

	async listFiles(knowledgeBaseId: string): Promise<KnowledgeBaseFile[]> {
		const data = await this.request<{docs: KnowledgeBaseFile[]; total_datasets?: number}>("GET", `/api/v1/datasets/${knowledgeBaseId}/documents`);
		return data?.docs ?? [];
	}

	async uploadFile(knowledgeBaseId: string, payload: UploadFilePayload | UploadFilePayload[]): Promise<KnowledgeBaseFile[]> {
		const files = Array.isArray(payload) ? payload : [payload];
		const form = new FormData();
		for (const file of files) {
			const blob = this.buildUploadBlob(file);
			form.append("file", blob, file.fileName);
		}
		const {body, contentType} = await this.formDataToRequestBody(form);
		const data = await this.request<KnowledgeBaseFile[]>("POST", `/api/v1/datasets/${knowledgeBaseId}/documents`, undefined, body, contentType);
		return data ?? [];
	}

	async deleteFile(knowledgeBaseId: string, fileId: string): Promise<void> {
		await this.request<unknown>("DELETE", `/api/v1/datasets/${knowledgeBaseId}/documents`, {ids: [fileId]});
	}

	async updateFile(knowledgeBaseId: string, fileId: string, payload: UpdateFilePayload): Promise<void> {
		await this.request<unknown>("PUT", `/api/v1/datasets/${knowledgeBaseId}/documents/${fileId}`, payload);
	}

	async downloadFile(knowledgeBaseId: string, fileId: string): Promise<ArrayBuffer> {
		const response = await requestUrl({
			url: `${this.baseUrl}/api/v1/datasets/${knowledgeBaseId}/documents/${fileId}`,
			method: "GET",
			headers: {Authorization: `Bearer ${this.apiKey}`},
			throw: false
		});

		if (response.status >= 400) {
			const message = response.text || `Request failed with status ${response.status}`;
			throw new Error(`Ragflow request error: ${message}`);
		}

		// Obsidian's requestUrl provides arrayBuffer when available; fallback to text encoding.
		if (response.arrayBuffer) {
			return response.arrayBuffer;
		}

		return new TextEncoder().encode(response.text ?? "").buffer;
	}

	private async request<T>(
		method: HttpMethod,
		path: string,
		queryOrBody?: KnowledgeBaseInput | Partial<KnowledgeBaseInput> | UpdateFilePayload | Record<string, unknown>,
		rawBody?: string | ArrayBuffer | null,
		contentTypeOverride?: string
	): Promise<T> {
		if (!this.baseUrl) {
			throw new Error("Ragflow base URL is not configured");
		}
		if (!this.apiKey) {
			throw new Error("Ragflow API key is not configured");
		}

		const url = new URL(`${this.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`);
		const isGet = method === "GET";
		if (isGet && queryOrBody && typeof queryOrBody === "object") {
			Object.entries(queryOrBody as Record<string, unknown>).forEach(([key, value]) => {
				if (value === undefined || value === null) return;
				url.searchParams.append(key, String(value));
			});
		}

		const headers: Record<string, string> = {
			Authorization: `Bearer ${this.apiKey}`
		};

		if (contentTypeOverride) {
			headers["Content-Type"] = contentTypeOverride;
		} else if (!rawBody && method !== "GET") {
			headers["Content-Type"] = "application/json";
		}

		if (this.vaultName) {
			headers["X-Ragflow-Vault"] = this.vaultName;
		}

		const body: string | ArrayBuffer | undefined = isGet
			? undefined
			: (rawBody ?? (queryOrBody ? JSON.stringify(queryOrBody) : undefined));

		const loggedHeaders = {...headers};
		if (loggedHeaders.Authorization) {
			const token = loggedHeaders.Authorization;
			loggedHeaders.Authorization = `${token.slice(0, 12)}...`;
		}

		// bodyPreview was unused and removed to resolve lint warning

		const response = await requestUrl({
			url: url.toString(),
			method,
			headers,
			body,
			throw: false
		});

		if (response.status >= 400) {
			const message = response.text || `Request failed with status ${response.status}`;
			throw new Error(`Ragflow request error: ${message}`);
		}

		const json = response.json as ApiResponse<T> | T | undefined;
		if (json && typeof json === "object" && "code" in json) {
			const apiResp = json;
			if (apiResp.code !== undefined && apiResp.code !== 0) {
				throw new Error(apiResp.message ?? `Ragflow request error (code ${apiResp.code})`);
			}
			return apiResp.data ?? (json as T);
		}

		return json as T;
	}

	private async formDataToRequestBody(form: FormData): Promise<{body: ArrayBuffer; contentType?: string}> {
		// Using the standard Request builder to serialize FormData and extract the generated boundary header.
		const request = new Request("http://localhost", {method: "POST", body: form});
		const body = await request.arrayBuffer();
		const contentType = request.headers.get("content-type") ?? undefined;
		return {body, contentType};
	}

	private buildUploadBlob(file: UploadFilePayload): Blob {
		const mimeType = file.mimeType ?? "application/octet-stream";
		if (file.data instanceof Blob) return file.data;
		if (typeof file.data === "string") return new Blob([file.data], {type: mimeType});
		if (file.data instanceof ArrayBuffer) return new Blob([file.data], {type: mimeType});
		if (ArrayBuffer.isView(file.data)) {
			const view = file.data;
			// Ensure we always pass an ArrayBuffer (SharedArrayBuffer is not a valid BlobPart)
			const buffer = view.buffer instanceof ArrayBuffer
				? view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)
				: (() => {
					const copy = new Uint8Array(view.byteLength);
					copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
					return copy.buffer;
				})();
			return new Blob([buffer], {type: mimeType});
		}
		throw new Error("Unsupported upload payload");
	}
}

export const createRagflowApi = (settings: RagFlowSyncPluginSettings): RagflowApi => {
	return new RagflowApi({
		baseUrl: settings.baseUrl,
		apiKey: settings.apiKey,
		vaultName: settings.vaultName
	});
};
