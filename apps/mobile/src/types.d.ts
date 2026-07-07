// The packed worklet: bare-pack emits an ES module whose default export is
// the serialized bundle Worklet.start() consumes.
declare module '*/app.bundle.mjs' {
  const bundle: string;
  export default bundle;
}
