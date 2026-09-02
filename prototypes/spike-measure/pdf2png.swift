// PROTOTYPE (wayfinder #8). Rasterise page 1 of a PDF to a PNG of the given pixel size.
// swift pdf2png.swift in.pdf out.png 1280 720
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
let doc = CGPDFDocument(URL(fileURLWithPath: args[1]) as CFURL)!
let page = doc.page(at: 1)!
let w = Int(args[3])!, h = Int(args[4])!
let box = page.getBoxRect(.mediaBox)
let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
ctx.scaleBy(x: CGFloat(w) / box.width, y: CGFloat(h) / box.height)
ctx.drawPDFPage(page)
let img = ctx.makeImage()!
let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: args[2]) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, img, nil)
CGImageDestinationFinalize(dest)
print("pdf page \(box.width)x\(box.height)pt -> \(w)x\(h)px")
