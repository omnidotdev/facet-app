//! Facet geometry kernel, compiled to WebAssembly.
//!
//! P1 is a BSP-tree CSG engine (a Rust port of the app's TypeScript kernel), so
//! the Rust -> WASM pipeline is proven end to end behind the same `Kernel`
//! interface. P2 swaps these geometry internals for a `truck` B-rep kernel
//! (exact geometry + STEP export) without changing the op-graph bridge below.

mod csg;
mod opgraph;

use wasm_bindgen::prelude::*;

/// A flat, non-indexed triangle mesh handed back to JS as two Float32Arrays.
#[wasm_bindgen]
pub struct MeshResult {
    positions: Vec<f32>,
    normals: Vec<f32>,
}

#[wasm_bindgen]
impl MeshResult {
    #[wasm_bindgen(getter)]
    pub fn positions(&self) -> Vec<f32> {
        self.positions.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn normals(&self) -> Vec<f32> {
        self.normals.clone()
    }

    #[wasm_bindgen(getter, js_name = triangleCount)]
    pub fn triangle_count(&self) -> usize {
        self.positions.len() / 9
    }
}

/// The kernel identifier, mirrored into the app's kernel picker.
#[wasm_bindgen]
pub fn name() -> String {
    "facet-rust-csg".to_string()
}

/// Evaluate a serialized op-graph into a triangle mesh.
#[wasm_bindgen]
pub fn evaluate(op_json: &str) -> Result<MeshResult, JsValue> {
    let node: opgraph::OpNode =
        serde_json::from_str(op_json).map_err(|e| JsValue::from_str(&format!("bad op-graph: {e}")))?;
    let solid = opgraph::eval_node(&node);
    let (positions, normals) = csg::to_mesh(&solid);
    Ok(MeshResult { positions, normals })
}
