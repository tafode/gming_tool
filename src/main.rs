mod app;
mod model;

use app::GmingToolApp;
use eframe::egui;

fn main() -> eframe::Result<()> {
    let native_options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_title("GMing Tool")
            .with_inner_size([1280.0, 800.0])
            .with_min_inner_size([800.0, 500.0]),
        ..Default::default()
    };

    eframe::run_native(
        "GMing Tool",
        native_options,
        Box::new(|_cc| Ok(Box::new(GmingToolApp::new()))),
    )
}
