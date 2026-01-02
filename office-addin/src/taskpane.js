/*
 * Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
 * See LICENSE in the project root for license information.
 */

// Global helper for UI Tabs
window.openTab = function (evt, tabName) {
    var i, tabcontent, tablinks;
    tabcontent = document.getElementsByClassName("tab-content");
    for (i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = "none";
    }
    tablinks = document.getElementsByClassName("tab-link");
    for (i = 0; i < tablinks.length; i++) {
        tablinks[i].className = tablinks[i].className.replace(" active", "");
    }
    document.getElementById(tabName).style.display = "block";
    evt.currentTarget.className += " active";
}

Office.onReady((info) => {
    if (info.host === Office.HostType.PowerPoint) {
        // Assign event handlers to buttons
        document.getElementById("btn-matrix-2x2").onclick = () => tryCatch(insertMatrix);
        document.getElementById("btn-3-columns").onclick = () => tryCatch(insert3Columns);
        document.getElementById("btn-stamp-draft").onclick = () => tryCatch(() => insertStamp("DRAFT", "#888888"));
        document.getElementById("btn-stamp-confidential").onclick = () => tryCatch(() => insertStamp("CONFIDENTIAL", "#FF0000"));
        document.getElementById("btn-fix-fonts").onclick = () => tryCatch(fixFonts);
    }
});

async function insertMatrix() {
    await PowerPoint.run(async (context) => {
        const slide = context.presentation.getSelectedSlides().getItemAt(0);

        // Define sizes (Points)
        const margin = 50;
        const width = 800;
        const height = 400;
        const gap = 10;
        const boxW = (width - gap) / 2;
        const boxH = (height - gap) / 2;

        // Top Left
        let s1 = slide.shapes.addGeometricShape(PowerPoint.GeometricShapeType.rectangle);
        s1.left = margin;
        s1.top = margin;
        s1.width = boxW;
        s1.height = boxH;
        s1.fill.setSolidColor("#E8F0F7"); // Light Blue
        s1.textFrame.textRange.text = "Quadrant 1";
        s1.lineFormat.visible = false;

        // Top Right
        let s2 = slide.shapes.addGeometricShape(PowerPoint.GeometricShapeType.rectangle);
        s2.left = margin + boxW + gap;
        s2.top = margin;
        s2.width = boxW;
        s2.height = boxH;
        s2.fill.setSolidColor("#F7F8F9"); // Light Gray
        s2.textFrame.textRange.text = "Quadrant 2";
        s2.lineFormat.visible = false;

        // Bottom Left
        let s3 = slide.shapes.addGeometricShape(PowerPoint.GeometricShapeType.rectangle);
        s3.left = margin;
        s3.top = margin + boxH + gap;
        s3.width = boxW;
        s3.height = boxH;
        s3.fill.setSolidColor("#F7F8F9"); // Light Gray
        s3.textFrame.textRange.text = "Quadrant 3";
        s3.lineFormat.visible = false;

        // Bottom Right
        let s4 = slide.shapes.addGeometricShape(PowerPoint.GeometricShapeType.rectangle);
        s4.left = margin + boxW + gap;
        s4.top = margin + boxH + gap;
        s4.width = boxW;
        s4.height = boxH;
        s4.fill.setSolidColor("#E8F0F7"); // Light Blue
        s4.textFrame.textRange.text = "Quadrant 4";
        s4.lineFormat.visible = false;

        await context.sync();
    });
}

async function insert3Columns() {
    await PowerPoint.run(async (context) => {
        const slide = context.presentation.getSelectedSlides().getItemAt(0);
        const margin = 50;
        const width = 850;
        const height = 400;
        const gap = 20;
        const boxW = (width - gap * 2) / 3;

        const titles = ["現状 (As-Is)", "課題 (Issues)", "あるべき姿 (To-Be)"];

        for (let i = 0; i < 3; i++) {
            let shape = slide.shapes.addGeometricShape(PowerPoint.GeometricShapeType.rectangle);
            shape.left = margin + (boxW + gap) * i;
            shape.top = margin;
            shape.width = boxW;
            shape.height = height;
            shape.fill.setSolidColor("white");
            shape.lineFormat.color = "#0078d4";
            shape.lineFormat.weight = 2;

            shape.textFrame.textRange.text = titles[i] + "\n\n";
            // shape.textFrame.textRange.font.bold = true; // API varies, keep simple first
        }
        await context.sync();
    });
}

async function insertStamp(text, color) {
    await PowerPoint.run(async (context) => {
        const slide = context.presentation.getSelectedSlides().getItemAt(0);

        let textBox = slide.shapes.addTextBox(text);
        textBox.left = 800; // Far right (Standard 960 width)
        textBox.top = 20;
        textBox.width = 150;
        textBox.height = 30;

        let range = textBox.textFrame.textRange;
        range.font.bold = true;
        range.font.size = 14;
        range.font.color = color;

        // Rotate simpler manually or via API if supported (Rotation support varies in web)
        // textBox.rotation = -15; 

        await context.sync();
    });
}

async function fixFonts() {
    await PowerPoint.run(async (context) => {
        const slide = context.presentation.getSelectedSlides().getItemAt(0);
        const shapes = slide.shapes;
        shapes.load("items");

        await context.sync();

        for (let i = 0; i < shapes.items.length; i++) {
            const shape = shapes.items[i];

            // Try to set font. Note: Handling groups or complex shapes needs recursion.
            // This is a basic implementation for standalone shapes/textboxes.
            try {
                // We need to load textFrame property before accessing
                shape.load("textFrame");
                await context.sync();

                if (shape.textFrame) {
                    shape.textFrame.textRange.load("font");
                    await context.sync();

                    shape.textFrame.textRange.font.name = "Meiryo UI";
                }
            } catch (error) {
                console.log("Shape " + i + " error or no text: " + error);
            }
        }

        await context.sync();
    });
}

/** Default helper for invoking an action and handling errors. */
async function tryCatch(callback) {
    try {
        await callback();
    } catch (error) {
        console.error(error);
        if (error instanceof OfficeExtension.Error) {
            console.log("Debug info: " + JSON.stringify(error.debugInfo));
        }
    }
}
