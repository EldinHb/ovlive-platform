use std::path::PathBuf;

fn main() {
    // Use the vendored protoc so no system protoc install is required (dev or Docker).
    let protoc = protoc_bin_vendored::protoc_bin_path().expect("vendored protoc");
    std::env::set_var("PROTOC", protoc);

    let proto_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/proto")
        .canonicalize()
        .expect("packages/proto exists");
    let proto_file = proto_root.join("ovlive.proto");

    println!("cargo:rerun-if-changed={}", proto_file.display());

    prost_build::compile_protos(&[proto_file], &[proto_root]).expect("compile ovlive.proto");
}
