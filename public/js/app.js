var Store = (function() {

    var USE_LOCAL_STORAGE = true;
    var _store = USE_LOCAL_STORAGE && window.localStorage || { };

    return {
        get: function(key) {
            if (_store[key] !== undefined) {
                try {
                    return JSON.parse(_store[key]);
                } catch(e) { }
            }
        },
        set: function(key, val) {
            _store[key] = JSON.stringify(val);
        },
        clear: function() {
            if (window.localStorage && _store === window.localStorage && window.localStorage.clear) {
                window.localStorage.clear();
            }
            else {
                _store = {};
            }
        }
    };

})();

var FileStore = {
    get: function() {
        return Store.get("files") || [];
    },
    getByID: function(id) {
        return _.filter(FileStore.get(), function(f) {
            return id == f.id;
        })[0] || { };
    },
    push: function(file) {
        var files = FileStore.get();
        files.push(file);
        Store.set("files", files);
    },
    clear: function() {
        Store.set("files", []);
    }
};

log("Stored Files", Store.get("files"));

var FrameBuffer = {
    _frames: [],
    set: function(content) {
        FrameBuffer.clear();
        FrameBuffer.add(content);
    },
    add: function(content) {
        FrameBuffer._frames.push({
            content: content,
            timestamp: Date.now()
        });

        $("#num-frames").text(FrameBuffer._frames.length);
    },
    clear: function() {
        FrameBuffer._frames = [];
    },
    get: function() {
        return FrameBuffer._frames;
    }
};

var AppView = Backbone.View.extend({

    SEND_TO_SERVER: false,
    thumbTemplate: Handlebars.compile($("#video-list").html()),

    events: {
        "click #save": "save",
        "click .save-image": "saveImage",
        "click #record": "toggleRecord",
        "click #results li": "previewFile",
        "click": "cancelPreview",
        "click #snapshot": "takeSnapshot"
    },

    cancelPreview: function() {
        $("body").removeClass("previewing");
    },

    previewFile: function(e) {

        var file = FileStore.getByID($(e.currentTarget).data("id"));
        if (file.frames) {
            this.GL.stop();
            $("#imgascii").html(file.frames[0].content);
            /*
            $("body").addClass("previewing");
            $("#full-preview a").attr("href", "/view/" + file.id).text(file.id);
            $("#full-preview pre").html(file.frames[0].content);
            */
        }

        return false;

    },

    toggleRecord: function() {
        var record = $("#record");

        if (!this.recording) {
            FrameBuffer.clear();
            record.addClass("btn-warning");
        }
        else {
            record.removeClass("btn-warning");
            this.save();
        }

        this.recording = !this.recording;
    },

    getCurrentFrames: function() {
        return FrameBuffer.get();
    },

    saveImage: function(e) {

        var frame = $(e.currentTarget).closest(".gram-container").find("pre").html();
        FrameBuffer.set(frame);

        this.pushCurrentBufferToServer(function(id) {
            $(e.currentTarget).closest(".gram-container").find("a").attr("href", "/view/" + id).text(id);
        });
    },

    addDataURLSnapshot: function(url) {

        var that = this;
        var img = new Image();
        img.onload = function() {
            var pre = $("<pre />");
            App.asciiImage(img, pre[0]);
            FrameBuffer.set(pre.html());

            that.addVideoToLocalStorage(guid(), that.getCurrentFrames());
        };
        img.src = url;

    },

    takeSnapshot: function(e) {
        var frame = $("#videoascii").html();
        FrameBuffer.set(frame);

        this.pushCurrentBufferToServer(function() {
            log("Snapshot taken");
        });
    },

    pushCurrentBufferToServer: function(cb) {
        var frames = this.getCurrentFrames();
        var ajax = $.post("add", { frames: JSON.stringify(frames) });
        var that = this;
        ajax.done(function(id) {
            that.addVideoToLocalStorage(id, frames);
            cb(id);
        });
    },

    renderThumbs: function() {

        var that = this;
        var templateHTML = _.map(FileStore.get(), function(i) {

            return that.thumbTemplate({
                preview: new Frame(i.frames[0]).content,
                id: i.id
            });

        }).join("");

        $("#results").html(templateHTML);
    },

    save: function() {

        var frames = this.getCurrentFrames();

        if (frames.length === 0) {
            log("Error, no frames provided");
            return;
        }

        if (this.SEND_TO_SERVER) {
            var ajax = $.post("add", { frames: JSON.stringify(frames) });
            var that = this;
            ajax.done(function(id) {
                that.addVideoToLocalStorage(id, frames);
            });
        }
        else {
            FileStore.push({
                id: guid(),
                frames: frames
            });

            this.renderThumbs();
        }
    },

    addVideoToLocalStorage: function(id, frames) {

        FileStore.push({
            id: id,
            frames: frames
        });

        this.renderThumbs();
    },

    initialize: function() {

        this.asciiLogo();

        var that = this;
        Jscii.renderVideo($('#video')[0], $('#videoascii')[0], function() {
            $("body").removeClass("no-video").addClass("yes-video");
            FrameBuffer.clear();
        }, function(markup) {
            if (that.recording) {
                FrameBuffer.add(markup);
            }
        });

        this.renderThumbs();

        FileReaderJS.setupDrop(document.body, this.fileReaderOpts);
        FileReaderJS.setupClipboard(document.body, this.fileReaderOpts);
        FileReaderJS.setupInput(document.getElementById('file-input'), this.fileReaderOpts);
    },

    fileReaderOpts: {
        accept: "image/*",
        on: {
            load: function(e, file) {
                App.addDataURLSnapshot(e.target.result);
                //var container = $("<div class='gram-container'><pre></pre><div><button class='btn save-image'>Save</button><a target='_blank'></a></div>").appendTo("body");
            }
        }
    },

    asciiLogo: function() {
        var img = $("#logo");
        var container = $("#imgascii")[0];
        var that = this;

        function onload() {
            that.asciiImage(img[0], container, function() {
                that.GL = new GLView({ image: $("#logo") });
                img.hide();
            });

        }

        if (img[0].complete) {
            onload();
        }
        else {
            img.on("load", onload);
        }
    },

    asciiImage: function(image, container, cb) {
        Jscii.renderImage(image, container, cb);
    }

});

var GLView = Backbone.View.extend({

    WARP_SIZE: 140,
    distorting: true,
    initialize: function(opts) {
        if (!opts.image) {
            throw "No Image provided";
        }

        this.image = opts.image;

        this.placeholder = $("#gl-container");
        this.asciiContainer= $("#imgascii");

        try {
            this.canvas = fx.canvas();
        }
        catch (e) {
            this.canvas = $([]);
            return;
        }

        var that = this;
        if (this.image[0].complete) {
            this.setupGL();
        }
        else {
            this.image.on("load", function() {
                that.setupGL();
            });
        }
    },
    stop: function() {
        this.distorting = false;
        this.placeholder.unbind("click mousemove");
        $(this.canvas).remove();
    },
    toggle: function() {
        this.distorting = !this.distorting;
    },
    start: function() {
        this.distorting = true;
    },
    setupGL: function() {

        var image = this.image[0];
        var placeholder = this.placeholder;
        var asciiContainer= this.asciiContainer;

        var asciiWidth = asciiContainer.width();

        $(image).width(asciiWidth);

        var canvas = this.canvas;

        $(image).show();

        // Create a texture from the image and draw it to the canvas
        var texture = canvas.texture(image);

        $(image).hide();
        canvas.draw(texture).update();


        var that = this;
        // Draw a swirl under the mouse
        $(placeholder).click(function(e) {
            that.toggle();
        });

        var WARP_SIZE = this.WARP_SIZE;
        $(placeholder).mousemove(function(e) {
            if (that.distorting) {
                var offset = $(canvas).offset();
                var x = e.pageX - offset.left;
                var y = e.pageY - offset.top;
                canvas.draw(texture).swirl(x, y, WARP_SIZE, 4).update();
                Jscii.renderImage(canvas, asciiContainer[0]);
            }
        });

        placeholder.append(canvas);
        $(canvas).offset(asciiContainer.offset());
    }

});

$('.share').html(generateShareLinks("http://google.com", "some description"));

if (window.APP) {
    var App = new AppView({ el: $("body") });
}

