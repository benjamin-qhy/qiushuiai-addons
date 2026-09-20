/**
 * index.ts — Entry point for git-query-tools extension.
 *
 * Re-exports the default supervisor function so that qiushuiai can load
 * this folder as a single extension module.
 */

export { default } from "./supervisor.js";
