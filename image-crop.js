(() => {
  const modal = document.getElementById("imageCropModal");
  const canvas = document.getElementById("imageCropCanvas");
  const context = canvas.getContext("2d");
  const saveButton = document.getElementById("saveImageCrop");
  let resolveCrop = null;
  let sourceImage = null;
  let selection = null;
  let dragStart = null;
  let pointerId = null;

  function draw() {
    if (!sourceImage) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);
    if (!selection || selection.width < 2 || selection.height < 2) {
      saveButton.disabled = true;
      return;
    }

    context.save();
    context.fillStyle = "rgba(16, 25, 38, .58)";
    context.fillRect(0, 0, canvas.width, selection.y);
    context.fillRect(0, selection.y + selection.height, canvas.width, canvas.height - selection.y - selection.height);
    context.fillRect(0, selection.y, selection.x, selection.height);
    context.fillRect(selection.x + selection.width, selection.y, canvas.width - selection.x - selection.width, selection.height);
    context.strokeStyle = "#ffffff";
    context.lineWidth = Math.max(2, canvas.width / 360);
    context.setLineDash([8, 5]);
    context.strokeRect(selection.x, selection.y, selection.width, selection.height);
    context.restore();
    saveButton.disabled = false;
  }

  function pointerPosition(event) {
    const bounds = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, (event.clientX - bounds.left) * canvas.width / bounds.width)),
      y: Math.max(0, Math.min(canvas.height, (event.clientY - bounds.top) * canvas.height / bounds.height))
    };
  }

  canvas.addEventListener("pointerdown", event => {
    if (!sourceImage) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    pointerId = event.pointerId;
    dragStart = pointerPosition(event);
    selection = { x: dragStart.x, y: dragStart.y, width: 0, height: 0 };
    draw();
  });

  canvas.addEventListener("pointermove", event => {
    if (pointerId !== event.pointerId || !dragStart) return;
    const point = pointerPosition(event);
    selection = {
      x: Math.min(dragStart.x, point.x),
      y: Math.min(dragStart.y, point.y),
      width: Math.abs(point.x - dragStart.x),
      height: Math.abs(point.y - dragStart.y)
    };
    draw();
  });

  function finishPointer(event) {
    if (pointerId !== event.pointerId) return;
    pointerId = null;
    dragStart = null;
    draw();
  }
  canvas.addEventListener("pointerup", finishPointer);
  canvas.addEventListener("pointercancel", finishPointer);

  function close(result) {
    if (resolveCrop) {
      resolveCrop(result);
      resolveCrop = null;
    }
    modal.classList.add("hidden");
    if (![...document.querySelectorAll(".modal")].some(item => item !== modal && !item.classList.contains("hidden"))) {
      document.body.classList.remove("modal-open");
    }
    sourceImage = null;
    selection = null;
    context.clearRect(0, 0, canvas.width, canvas.height);
  }

  document.getElementById("cancelImageCrop").addEventListener("click", () => close(null));
  modal.addEventListener("click", event => {
    if (event.target === modal) close(null);
  });
  document.getElementById("resetImageCrop").addEventListener("click", () => {
    selection = { x: 0, y: 0, width: canvas.width, height: canvas.height };
    draw();
  });
  saveButton.addEventListener("click", () => {
    if (!selection || selection.width < 2 || selection.height < 2) return;
    const output = document.createElement("canvas");
    const scale = Math.min(1, 1400 / Math.max(selection.width, selection.height));
    output.width = Math.max(1, Math.round(selection.width * scale));
    output.height = Math.max(1, Math.round(selection.height * scale));
    const outputContext = output.getContext("2d");
    outputContext.fillStyle = "#ffffff";
    outputContext.fillRect(0, 0, output.width, output.height);
    outputContext.drawImage(
      canvas,
      selection.x, selection.y, selection.width, selection.height,
      0, 0, output.width, output.height
    );
    close(output.toDataURL("image/jpeg", 0.82));
  });

  window.cropProductImage = source => new Promise((resolve, reject) => {
    if (!(source instanceof Blob) && typeof source !== "string") {
      reject(new TypeError("مصدر الصورة غير صالح."));
      return;
    }
    const image = new Image();
    let objectURL = "";
    image.onload = () => {
      if (objectURL) URL.revokeObjectURL(objectURL);
      const scale = Math.min(1, 1000 / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      sourceImage = image;
      selection = {
        x: canvas.width * 0.08,
        y: canvas.height * 0.08,
        width: canvas.width * 0.84,
        height: canvas.height * 0.84
      };
      resolveCrop = resolve;
      draw();
      modal.classList.remove("hidden");
      document.body.classList.add("modal-open");
    };
    image.onerror = () => {
      if (objectURL) URL.revokeObjectURL(objectURL);
      reject(new Error("تعذر فتح الصورة المختارة."));
    };
    if (source instanceof Blob) {
      objectURL = URL.createObjectURL(source);
      image.src = objectURL;
    } else {
      image.src = source;
    }
  });
})();
