const mongoose = require('mongoose');

const basketballSavedModelSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 120,
    },
    runId: {
      type: String,
      required: true,
      trim: true,
    },
    runRecord: {
      type: Object,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

basketballSavedModelSchema.index({ createdAt: -1 });

const BasketballSavedModel = mongoose.model('BasketballSavedModel', basketballSavedModelSchema);

module.exports = {
  BasketballSavedModel,
};
