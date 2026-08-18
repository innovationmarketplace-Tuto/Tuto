/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ai_provider from "../ai/provider.js";
import type * as ai_tutor from "../ai/tutor.js";
import type * as artifacts from "../artifacts.js";
import type * as auth from "../auth.js";
import type * as awsDocumentAnalysis from "../awsDocumentAnalysis.js";
import type * as documentAnalysis from "../documentAnalysis.js";
import type * as document_analysis_adapter from "../document_analysis/adapter.js";
import type * as document_analysis_provider from "../document_analysis/provider.js";
import type * as evidence from "../evidence.js";
import type * as exports from "../exports.js";
import type * as http from "../http.js";
import type * as inference from "../inference.js";
import type * as learners from "../learners.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_db from "../lib/db.js";
import type * as lib_documentAnalyzer from "../lib/documentAnalyzer.js";
import type * as lib_guards from "../lib/guards.js";
import type * as lib_tutor from "../lib/tutor.js";
import type * as lib_validation from "../lib/validation.js";
import type * as memory from "../memory.js";
import type * as messages from "../messages.js";
import type * as seed from "../seed.js";
import type * as skills from "../skills.js";
import type * as tutor from "../tutor.js";
import type * as tutorProvider from "../tutorProvider.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "ai/provider": typeof ai_provider;
  "ai/tutor": typeof ai_tutor;
  artifacts: typeof artifacts;
  auth: typeof auth;
  awsDocumentAnalysis: typeof awsDocumentAnalysis;
  documentAnalysis: typeof documentAnalysis;
  "document_analysis/adapter": typeof document_analysis_adapter;
  "document_analysis/provider": typeof document_analysis_provider;
  evidence: typeof evidence;
  exports: typeof exports;
  http: typeof http;
  inference: typeof inference;
  learners: typeof learners;
  "lib/auth": typeof lib_auth;
  "lib/db": typeof lib_db;
  "lib/documentAnalyzer": typeof lib_documentAnalyzer;
  "lib/guards": typeof lib_guards;
  "lib/tutor": typeof lib_tutor;
  "lib/validation": typeof lib_validation;
  memory: typeof memory;
  messages: typeof messages;
  seed: typeof seed;
  skills: typeof skills;
  tutor: typeof tutor;
  tutorProvider: typeof tutorProvider;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
