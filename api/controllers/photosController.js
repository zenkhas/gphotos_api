const { UPLOAD_PATH, THUMBNAIL_PATH } = require("../../config");
const {
  generateThumbnail,
  getPhotosFromDisk,
  deleteFilesInDir,
  createDirectory,
  getExif,
  calculateMegaPixels,
  formatBytes,
  convertCoordinate,
  toFixedTrunc,
  deleteFile,
} = require("../utils/Utils");
const multer = require("multer");
const path = require("path");
const Photo = require("../models/photoModel");
const Faces = require("../models/facesModel");
import moment from "moment";
import { existsSync } from "fs";
import { STATUS_CODES } from "../STATUS_CODES";
import mongoose from "mongoose";

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_PATH);
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname); //Appending extension
  },
});

const fileFilter = (req, file, callback) => {
  let ext = path.extname(file.originalname);
  const whitelist = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
  if (!whitelist.includes(file.mimetype)) {
    return callback(new Error("Only images are allowed"));
  }

  if (existsSync(path.join(UPLOAD_PATH, file.originalname))) {
    callback(null, false);
  }
  callback(null, true);
};

exports.getPhotos = async (req, res) => {
  let arrPhotos = await Photo.find({
    trashed: false,
  });
  res.send(JSON.stringify(arrPhotos));
};

exports.getTrashedPhotos = async (req, res) => {
  let arrPhotos = await Photo.find({
    trashed: true,
  });
  res.send(JSON.stringify(arrPhotos));
};

exports.generateThumbnailsAndExif = async (req, res, next) => {
  try {
    let promises = req?.files?.map(async (image) => {
      await generateThumbnail(image);
      const exif = await getExif(image.path);
      let metaData = "";
      let date = moment();

      if (exif) {
        const dateCreated = exif?.exif?.CreateDate
          ? exif?.exif?.CreateDate
          : moment().format("YYYY-MM-DD HH:mm:ss");
        date = moment(dateCreated, "YYYY-MM-DD HH:mm:ss");
        const width = exif?.image?.ImageHeight;
        const height = exif?.image?.ImageWidth;
        const megaPixels = calculateMegaPixels(width, height);
        const size = formatBytes(image?.size, true);
        const device = exif?.image?.Make + " " + exif?.image?.Model;
        const aperture = toFixedTrunc(exif?.exif?.MaxApertureValue, 1);
        const focalLength = exif?.exif?.FocalLength;
        const iso = exif?.exif?.ISO;
        const latitude = convertCoordinate(exif?.gps?.GPSLatitude);
        const longitude = convertCoordinate(exif?.gps?.GPSLongitude);
        //for some reason the library is confused between height and width and inverting them.
        const thumbWidth = exif?.thumbnail?.ExifImageHeight;
        const thumbHeight = exif?.thumbnail?.ExifImageWidth;

        metaData = JSON.stringify({
          dateCreated,
          megaPixels,
          width,
          height,
          size,
          device,
          aperture,
          focalLength,
          iso,
          latitude,
          longitude,
          thumbWidth,
          thumbHeight,
        });
      }

      let photo = new Photo({
        name: image?.filename,
        dateCreated: date,
        metaData,
      });
      let res = await photo.save();
      console.log("Photo saved at id: ", res?._id);
    });

    await Promise.all(promises);

    next();
  } catch (error) {
    console.log("Error: ", error);

    //Delete files so that they can be uploaded again
    try {
      await deleteFile(UPLOAD_PATH + image?.filename);
      await deleteFile(UPLOAD_PATH + "thumb_" + image?.filename);
    } catch (error) {}

    res
      .status(STATUS_CODES.SERVER_ERROR)
      .json({ message: "Something went wrong" });
  }
};

exports.deleteAll = async (req, res) => {
  try {
    try {
      await deleteFilesInDir(UPLOAD_PATH);
      await deleteFilesInDir(THUMBNAIL_PATH);
    } catch (error) {
      console.log("Error deleting files: ", error);
    }

    let deletePhotosRes = await Photo.deleteMany();
    let deleteFacesRes = await Faces.deleteMany();

    console.log("Delete Photos res: ", deletePhotosRes);
    console.log("Delete Faces res: ", deleteFacesRes);

    res.json({ message: "Deleted successfully!" });
  } catch (error) {
    console.log("Error: ", error);

    res
      .status(STATUS_CODES.SERVER_ERROR)
      .json({ message: "Could not delete files!" });
  }
};

exports.createDirectories = async (req, res, next) => {
  try {
    await createDirectory(UPLOAD_PATH);
    await createDirectory(THUMBNAIL_PATH);

    next();
  } catch (error) {
    res
      .status(STATUS_CODES.SERVER_ERROR)
      .json({ message: "Could not create directories" });
  }
};

exports.trash = async (req, res) => {
  try {
    if (!req?.body?.ids || req?.body?.ids == "") {
      return res
        .status(STATUS_CODES.PARAM_MISSING)
        .json({ message: "ids parameter is missing!" });
    }
    const idsArr = req?.body?.ids
      .split(",")
      .map((id) => mongoose.Types.ObjectId(id));
    console.log("idsArr: ", idsArr);

    let queryRes = await Photo.updateMany(
      {
        _id: {
          $in: idsArr,
        },
      },
      {
        trashed: true,
      }
    );

    res.json({
      message: `${queryRes.modifiedCount} Photos trashed successfully!`,
    });
  } catch (error) {
    console.log("Error: ", error);
    res
      .status(STATUS_CODES.SERVER_ERROR)
      .json({ message: "Could not trash files!" });
  }
};

exports.saveFaceDescriptors = async (req, res) => {
  console.log("Faces: ", req.body.faces);

  const facesObject = JSON.parse(req.body.faces);

  let labelsArr = Object.keys(facesObject);

  console.log("labelsArr: ", labelsArr);

  for (let i = 0; i < labelsArr.length; i++) {
    const label = labelsArr[i];
    let face = new Faces({
      label,
      descriptors: facesObject[label],
    });

    let res = await face.save();
    console.log("Face saved at id: ", res?._id);
  }

  res.json({ message: "Images uploaded!" });
};

exports.uploadPhotos = multer({
  storage,
  fileFilter,
}).array("photos");
