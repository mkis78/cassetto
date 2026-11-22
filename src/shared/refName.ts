// what we accept for branch/tag/remote names: nothing git could read as an option or as ref syntax
export const isValidRefName = (name: string): boolean => !!name && !/^-|\s|\.\.|[~^:?*[\\]/.test(name)
