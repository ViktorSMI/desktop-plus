import { DiffHunk } from './raw-diff'
import { Image } from './image'
import { SubmoduleStatus } from '../status'
/**
 * V8 has a limit on the size of string it can create, and unless we want to
 * trigger an unhandled exception we need to do the encoding conversion by hand
 */
export const maximumDiffStringSize = 268435441

export enum DiffType {
  /** Changes to a text file, which may be partially selected for commit */
  Text,
  /** Changes to a file with a known extension, which can be viewed in the app */
  Image,
  /** Changes to an unknown file format, which Git is unable to present in a human-friendly format */
  Binary,
  /** Change to a repository which is included as a submodule of this repository */
  Submodule,
  /** Diff is large enough to degrade ux if rendered */
  LargeText,
  /** Diff that will not be rendered */
  Unrenderable,
}

type LineEnding = 'CR' | 'LF' | 'CRLF'

export type LineEndingsChange = {
  from: LineEnding
  to: LineEnding
}

/** Parse the line ending string into an enum value (or `null` if unknown) */
export function parseLineEndingText(text: string): LineEnding | null {
  const input = text.trim()
  switch (input) {
    case 'CR':
      return 'CR'
    case 'LF':
      return 'LF'
    case 'CRLF':
      return 'CRLF'
    default:
      return null
  }
}

/**
 * Data returned as part of a textual diff from Desktop
 */
interface ITextDiffData {
  /** The unified text diff - including headers and context */
  readonly text: string
  /** The diff contents organized by hunk - how the git CLI outputs to the caller */
  readonly hunks: ReadonlyArray<DiffHunk>
  /** A warning from Git that the line endings have changed in this file and will affect the commit */
  readonly lineEndingsChange?: LineEndingsChange
  /** The largest line number in the diff  */
  readonly maxLineNumber: number
  /** Whether or not the diff has invisible bidi characters */
  readonly hasHiddenBidiChars: boolean
}

export interface ITextDiff extends ITextDiffData {
  readonly kind: DiffType.Text
}

/**
 * Data returned as part of an image diff in Desktop
 */
export interface IImageDiff {
  readonly kind: DiffType.Image

  /**
   * The previous image, if the file was modified or deleted
   *
   * Will be undefined for an added image
   */
  readonly previous?: Image
  /**
   * The current image, if the file was added or modified
   *
   * Will be undefined for a deleted image
   */
  readonly current?: Image

  /**
   * Text diff data for SVG files, which are text-based but renderable as images.
   * When present, a "Code" tab is shown as the first and default view mode.
   */
  readonly textDiff?: ITextDiffData
}

export type BinaryDiffChunkKind =
  | 'equal'
  | 'change'
  | 'equal-gap'
  | 'change-gap'

/**
 * A compact piece of a binary comparison. Equal regions are collapsed down to
 * a small amount of context, while large changed regions retain edge previews.
 */
export interface IBinaryDiffChunk {
  readonly kind: BinaryDiffChunkKind
  readonly previousOffset: number
  readonly currentOffset: number
  readonly previousLength: number
  readonly currentLength: number
  readonly previousData: ReadonlyArray<number>
  readonly currentData: ReadonlyArray<number>
  /** Index of the changed region this chunk belongs to, when applicable. */
  readonly changeIndex?: number
}

export interface IBinaryDiff {
  readonly kind: DiffType.Binary
  readonly previousSize?: number
  readonly currentSize?: number
  readonly previousComparedBytes?: number
  readonly currentComparedBytes?: number
  readonly chunks: ReadonlyArray<IBinaryDiffChunk>
  readonly changeCount: number
  /**
   * Whether both sides were compared in full. Oversized files may be limited to
   * a bounded prefix so the renderer process doesn't receive huge byte arrays.
   */
  readonly complete: boolean
}

export interface ISubmoduleDiff {
  readonly kind: DiffType.Submodule

  /** Full path of the submodule */
  readonly fullPath: string

  /** Path of the repository within its container repository */
  readonly path: string

  /** URL of the submodule */
  readonly url: string | null

  /** Status of the submodule */
  readonly status: SubmoduleStatus

  /** Previous SHA of the submodule, or null if it hasn't changed */
  readonly oldSHA: string | null

  /** New SHA of the submodule, or null if it hasn't changed */
  readonly newSHA: string | null
}

export interface ILargeTextDiff extends ITextDiffData {
  readonly kind: DiffType.LargeText
}

export interface IUnrenderableDiff {
  readonly kind: DiffType.Unrenderable
}

/** The union of diff types that can be rendered in Desktop */
export type IDiff =
  | ITextDiff
  | IImageDiff
  | IBinaryDiff
  | ISubmoduleDiff
  | ILargeTextDiff
  | IUnrenderableDiff
