/*! Copyright [Amazon.com](http://amazon.com/), Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0 */
import { NodePackageUtils } from "@aws/monorepo";
import { IgnoreFile, Task } from "projen";
import { NodePackageManager } from "projen/lib/javascript";
import {
  TypeScriptProject,
  TypeScriptProjectOptions,
} from "projen/lib/typescript";
import {
  CodeGenerationSourceOptions,
  GeneratedWithOpenApiGeneratorOptions,
} from "../../types";
import { TypeSafeApiCommandEnvironment } from "../components/type-safe-api-command-environment";
import {
  buildCodegenCommandArgs,
  buildTypeSafeApiExecCommand,
  CodegenOptions,
  TypeSafeApiScript,
} from "../components/utils";

/**
 * Configuration for the generated typescript client project
 */
export interface GeneratedTypescriptRuntimeBaseProjectOptions
  extends TypeScriptProjectOptions,
    GeneratedWithOpenApiGeneratorOptions,
    CodeGenerationSourceOptions {
  /**
   * Whether this project is parented by an monorepo or not
   */
  readonly isWithinMonorepo?: boolean;
}

/**
 * Typescript project containing types generated using OpenAPI Generator CLI
 */
export abstract class GeneratedTypescriptRuntimeBaseProject extends TypeScriptProject {
  /**
   * Options configured for the project
   */
  protected readonly options: GeneratedTypescriptRuntimeBaseProjectOptions;

  protected readonly generateTask: Task;

  constructor(options: GeneratedTypescriptRuntimeBaseProjectOptions) {
    super({
      ...options,
      sampleCode: false,
      tsconfig: {
        ...options.tsconfig,
        compilerOptions: {
          lib: ["dom", "es2019"],
          // Generated code isn't very strict!
          strict: false,
          alwaysStrict: false,
          noImplicitAny: false,
          noImplicitReturns: false,
          noImplicitThis: false,
          noUnusedLocals: false,
          noUnusedParameters: false,
          strictNullChecks: false,
          strictPropertyInitialization: false,
          skipLibCheck: true,
          ...options?.tsconfig?.compilerOptions,
        },
      },
      eslint: false,
      // Disable tests unless explicitly enabled
      jest: options.jest ?? false,
      npmignoreEnabled: false,
    });
    TypeSafeApiCommandEnvironment.ensure(this);
    this.options = options;

    // Disable strict peer dependencies for pnpm as the default typescript project dependencies have type mismatches
    // (ts-jest@27 and @types/jest@28)
    if (this.package.packageManager === NodePackageManager.PNPM) {
      this.npmrc.addConfig("strict-peer-dependencies", "false");
    }

    // For event and context types
    this.addDeps(
      "@types/aws-lambda",
      "@aws-lambda-powertools/tracer",
      "@aws-lambda-powertools/logger",
      "@aws-lambda-powertools/metrics"
    );

    // Minimal .npmignore to avoid impacting OpenAPI Generator
    const npmignore = new IgnoreFile(this, ".npmignore");
    npmignore.addPatterns("/.projen/", `/${this.srcdir}`, "/dist");

    this.generateTask = this.addTask("generate");
    this.generateTask.exec(
      buildTypeSafeApiExecCommand(
        TypeSafeApiScript.GENERATE_NEXT,
        this.buildGenerateCommandArgs()
      )
    );

    this.preCompileTask.spawn(this.generateTask);

    if (!options.commitGeneratedCode) {
      // Ignore all the generated code
      this.gitignore.addPatterns(this.srcdir, ".npmignore", "README.md");
    }

    this.gitignore.addPatterns(".openapi-generator", ".tsapi-manifest");

    // If we're not in a monorepo, we need to link the generated client such that any local dependency on it can be
    // resolved
    if (!options.isWithinMonorepo) {
      switch (this.package.packageManager) {
        case NodePackageManager.PNPM:
          // Nothing to do for pnpm, since the pnpm link command handles both the dependant and dependee
          break;
        default:
          this.tasks
            .tryFind("install")
            ?.exec(
              NodePackageUtils.command.cmd(this.package.packageManager, "link")
            );
          break;
      }
    }
  }

  public buildGenerateCommandArgs = () => {
    return buildCodegenCommandArgs(this.buildCodegenOptions());
  };

  protected abstract buildCodegenOptions(): CodegenOptions;
}
