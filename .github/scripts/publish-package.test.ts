import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(import.meta.dirname, "publish-package.sh");
const directories: string[] = [];

afterEach(() => {
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function release(tag: string, action = "publish") {
	const directory = mkdtempSync(join(tmpdir(), "pi-release-"));
	directories.push(directory);
	for (const name of ["pi-exec-command", "pi-libtui"]) {
		const packageDirectory = join(directory, "harnesses/pi/agent/packages", name);
		mkdirSync(packageDirectory, { recursive: true });
		writeFileSync(join(packageDirectory, "package.json"), JSON.stringify({ name: `@luan.sh/${name}`, version: "0.3.8" }));
	}
	const bin = join(directory, "bin");
	mkdirSync(bin);
	const just = join(bin, "just");
	writeFileSync(just, '#!/bin/sh\nprintf "%s\\n" "$@" >> "$CALL_LOG"\n');
	chmodSync(just, 0o755);
	const log = join(directory, "calls");
	writeFileSync(log, "");
	const result = Bun.spawnSync(["bash", script], {
		cwd: directory,
		env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RELEASE_TAG: tag, RELEASE_ACTION: action, CALL_LOG: log },
	});
	return { status: result.exitCode, calls: readFileSync(log, "utf8"), error: result.stderr.toString() };
}

test("publishes only the named package even when another has the same version", () => {
	expect(release("@luan.sh/pi-exec-command@0.3.8")).toEqual({
		status: 0,
		calls: "pi-publish\nharnesses/pi/agent/packages/pi-exec-command\n",
		error: "",
	});
});

test.each(["v0.3.8", "main", "pi-exec-command/v0.3.8", "@else/pi-exec-command@0.3.8", "@luan.sh/../pi-exec-command@0.3.8", "@luan.sh/pi-exec-command@0.3.8/extra"])(
	"rejects a non-package release tag: %s",
	(tag) => {
		const result = release(tag);
		expect(result.status).not.toBe(0);
		expect(result.calls).toBe("");
	},
);

test("rejects a tag that does not match the selected manifest version", () => {
	const result = release("@luan.sh/pi-exec-command@0.3.9");
	expect(result.status).not.toBe(0);
	expect(result.calls).toBe("");
	expect(result.error).toContain("does not match");
});

test.each(["", "@luan.sh/pi-exec-command@0.3.8", "pi-exec-command@0.3.8"])(
	"publishes only missing names in a dual release (existing: %s)",
	(existing) => {
		const directory = mkdtempSync(join(tmpdir(), "pi-dual-release-"));
		directories.push(directory);
		const packageDirectory = join(directory, "harnesses/pi/agent/packages/pi-exec-command");
		mkdirSync(packageDirectory, { recursive: true });
		writeFileSync(
			join(packageDirectory, "package.json"),
			JSON.stringify({ name: "@luan.sh/pi-exec-command", version: "0.3.8", publishAliases: ["pi-exec-command"] }),
		);
		for (const args of [
			["init", "--quiet"],
			["add", "."],
			["-c", "user.name=Release Test", "-c", "user.email=release@example.test", "commit", "--quiet", "-m", "fixture"],
			["tag", "@luan.sh/pi-exec-command@0.3.8"],
		]) {
			expect(Bun.spawnSync(["git", ...args], { cwd: directory }).exitCode).toBe(0);
		}
		const bin = join(directory, "bin");
		mkdirSync(bin);
		const packed = join(directory, "packed");
		const published = join(directory, "published");
		writeFileSync(packed, "");
		writeFileSync(published, "");
		writeFileSync(join(bin, "just"), '#!/bin/sh\nprintf "%s\\n" "$5" >> "$PACKED"\nprintf "%s\\n" "archive.tgz"\n');
		writeFileSync(
			join(bin, "npm"),
			'#!/bin/sh\ncase "$1" in\nview) test "$2" = "$EXISTING" && echo 0.3.8 ;;\npublish) echo published >> "$PUBLISHED" ;;\n*) exit 2 ;;\nesac\n',
		);
		chmodSync(join(bin, "just"), 0o755);
		chmodSync(join(bin, "npm"), 0o755);
		const just = Bun.which("just");
		if (!just) throw new Error("just is required for release tests");
		const result = Bun.spawnSync(
			[just, "--justfile", resolve(import.meta.dirname, "../../justfile"), `repo=${directory}`, "pi-publish", packageDirectory],
			{
				cwd: directory,
				env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, EXISTING: existing, PACKED: packed, PUBLISHED: published },
			},
		);
		expect(result.stderr.toString()).toBe("");
		expect(result.exitCode).toBe(0);
		const expected = ["@luan.sh/pi-exec-command", "pi-exec-command"].filter((name) => `${name}@0.3.8` !== existing);
		expect(readFileSync(packed, "utf8").trim().split("\n")).toEqual(expected);
		expect(readFileSync(published, "utf8").trim().split("\n")).toHaveLength(expected.length);
	},
);


test("build-only mode cannot publish during initial registration", () => {
	expect(release("@luan.sh/pi-exec-command@0.3.8", "pack")).toEqual({
		status: 0,
		calls: "pi-pack\nharnesses/pi/agent/packages/pi-exec-command\n",
		error: "",
	});
});

test("rejects an unknown action without invoking publishing", () => {
	const result = release("@luan.sh/pi-exec-command@0.3.8", "invalid");
	expect(result.status).not.toBe(0);
	expect(result.calls).toBe("");
});
