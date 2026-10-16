/**
 * dsh-batch-uninstall — Host half type declarations.
 *
 * The Host half is plain JavaScript; this file exists so `types` in
 * package.json points somewhere valid. No compiler is required.
 */
export declare const name: string;
export declare const inject: string[];

export interface ClassifiedBundle {
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  installed: boolean;
  optional: boolean;
  removable: boolean;
  core: boolean;
  risk: 'low' | 'medium' | 'high';
}

export declare function apply(ctx: unknown): void;
