mod app;
mod model;
mod music;

use std::sync::Arc;

use app::GmingToolApp;
use eframe::egui;
use model::store::AppDirs;
use music::output::SilentAudioOutput;
use music::resolver::PlaceholderResolver;

fn main() -> eframe::Result<()> {
    let dirs = match AppDirs::resolve() {
        Ok(dirs) => dirs,
        Err(err) => {
            eprintln!("gming_tool: {err}");
            std::process::exit(1);
        }
    };

    // Real audio (rodio) and real yt-dlp resolution arrive in the next step;
    // for now the UI runs against no-op backends so it can be explored.
    let resolver = Arc::new(PlaceholderResolver::new(dirs.audio_cache_dir()));
    let audio = Box::new(SilentAudioOutput::default());
    let app = GmingToolApp::new(dirs.save_file(), resolver, audio);

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
        Box::new(|_cc| Ok(Box::new(app))),
    )
}
