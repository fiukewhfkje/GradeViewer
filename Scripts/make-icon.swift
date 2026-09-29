import Foundation
import CoreGraphics
import ImageIO
let size = 1024
let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: size * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
context.setFillColor(CGColor(red: 0.14, green: 0.30, blue: 0.23, alpha: 1)); context.fill(CGRect(x: 0, y: 0, width: size, height: size))
context.setStrokeColor(CGColor(red: 0.97, green: 0.96, blue: 0.91, alpha: 1)); context.setLineWidth(60); context.setLineCap(.round); context.setLineJoin(.round)
context.move(to: CGPoint(x: 240, y: 335)); context.addLine(to: CGPoint(x: 420, y: 470)); context.addLine(to: CGPoint(x: 585, y: 445)); context.addLine(to: CGPoint(x: 775, y: 680)); context.strokePath()
context.setFillColor(CGColor(red: 0.73, green: 0.89, blue: 0.61, alpha: 1)); context.fillEllipse(in: CGRect(x: 725, y: 630, width: 100, height: 100))
let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: CommandLine.arguments[1]) as CFURL, "public.png" as CFString, 1, nil)!
CGImageDestinationAddImage(destination, context.makeImage()!, nil)
guard CGImageDestinationFinalize(destination) else { fatalError("Icon export failed") }
