import { join } from 'node:path'

type DirectoryNameDialogResult = { canceled: boolean; filePath?: string }

/** Uses Windows' editable save-style native field as the final directory-name selector. */
export async function chooseVideoNoteExportDestination(input: {
  desktopDirectory: string
  suggestedFolderName: string
  chooseDestination: (defaultPath: string) => Promise<DirectoryNameDialogResult>
}): Promise<string | undefined> {
  const destinationDirectory = join(input.desktopDirectory, input.suggestedFolderName)
  const result = await input.chooseDestination(destinationDirectory)
  return result.canceled ? undefined : result.filePath
}
