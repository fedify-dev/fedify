/**
 * @module @fedify/init
 * @description
 * This module provides the implementation for the `fedify init` command, which
 * initializes a new Fedify project with user-selected options for web framework,
 * package manager, key-value store, and message queue. It includes the command
 * definition, option parsing, and the main action handler that generates the
 * project files and configurations based on the user's choices.
 *
 * The `initCommand` is defined using `@optique/core`'s command and option
 * builders, allowing for interactive prompts and validation of user input.
 * The `runInit` function contains the logic for creating the project structure,
 * installing dependencies, and setting up configuration files according to the
 * selected options.
 *
 * Additionally, a `testInitCommand` is provided for integration testing purposes,
 * which runs the initialization process across various combinations of options
 * in temporary directories to ensure robustness and correctness of the setup.
 * The main entry point for initializing a new Fedify project.
 * Interactively prompts the user for options (web framework, package manager,
 * KV store, message queue), then generates project files and configurations
 * accordingly. Supports `--dry-run` mode for previewing without creating files.
 */
export { default as runInit } from "./action/mod.ts";
export { initCommand, initOptions } from "./command.ts";
